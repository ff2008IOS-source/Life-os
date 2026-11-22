"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import { Info, X } from "lucide-react";
import {
  mergeConfirmed,
  announceChange,
  keepConfirmedRows,
} from "@/lib/workspace-change";
import type { Workspace } from "@/lib/schemas";
import { Button } from "./ui/button";
type Recovery = { label: string; action: () => Promise<void> };
type Notice = {
  message: string;
  undo?: () => Promise<void>;
  recovery?: Recovery;
};
type Context = {
  data: Workspace;
  pending: boolean;
  isPending: (entity: string, id: string | null) => boolean;
  mutate: (
    entity: string,
    id: string | null,
    values: unknown,
    version?: number,
  ) => Promise<unknown>;
  refresh: () => Promise<void>;
  notify: (
    message: string,
    undo?: () => Promise<void>,
    recovery?: Recovery,
  ) => void;
  request: (url: string, options?: RequestInit) => Promise<unknown>;
};
const WorkspaceContext = createContext<Context | null>(null);
export function WorkspaceProvider({
  initial,
  children,
}: {
  initial: Workspace;
  children: React.ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [pendingActions, setPendingActions] = useState<Record<string, number>>(
    {},
  );
  const pending = Object.values(pendingActions).some((n) => n > 0);
  const isPending = (entity: string, id: string | null) =>
    (pendingActions[entity + ":" + (id ?? "create")] ?? 0) > 0;
  const [notice, setNotice] = useState<Notice | null>(null);
  const router = useRouter();
  const revision = useRef(0),
    readSequence = useRef(0);
  const operations = useRef(new Map<string, string>());
  const previousInitial = useRef(initial);
  useEffect(() => {
    if (previousInitial.current === initial) return;
    previousInitial.current = initial;
    const before = revision.current;
    const timer = setTimeout(() => {
      if (before === revision.current)
        setData(
          (previous) =>
            keepConfirmedRows(
              initial as unknown as Record<string, unknown>,
              previous as unknown as Record<string, unknown>,
              versions.current,
            ) as unknown as Workspace,
        );
    }, 0);
    return () => clearTimeout(timer);
  }, [initial]);
  const versions = useRef(new Map<string, number>());
  const [refreshPending, setRefreshPending] = useState(false);
  const confirmedReads = useRef(new Map<string, string>());
  const knownWrite = useRef(false);
  function accept(entity: string, record: { id: string; version?: number }) {
    const key = entity + ":" + record.id,
      known = versions.current.get(key);
    if (known !== undefined && known >= (record.version ?? 0)) return;
    versions.current.set(key, record.version ?? 0);
    revision.current++;
    setData((previous) => {
      const rows = previous[entity as keyof Workspace];
      return Array.isArray(rows)
        ? {
            ...previous,
            [entity]: mergeConfirmed(
              rows as { id: string; version?: number }[],
              record,
            ),
          }
        : previous;
    });
    announceChange([entity]);
  }
  async function recover() {
    let failed = false;
    await Promise.all(
      [...confirmedReads.current].map(async ([key, url]) => {
        try {
          const body = (await request(url)) as {
            data: { id: string; version?: number };
          };
          accept(key.split(":")[0], body.data);
          confirmedReads.current.delete(key);
        } catch {
          failed = true;
        }
      }),
    );
    setRefreshPending(failed);
  }
  const notify = useCallback(
    (message: string, undo?: () => Promise<void>, recovery?: Recovery) => {
      setNotice({ message, undo, recovery });
    },
    [],
  );
  async function request(url: string, options: RequestInit = {}) {
    if (options.method && options.method !== "GET") knownWrite.current = false;
    if (typeof navigator !== "undefined" && !navigator.onLine)
      throw Error("You’re offline. Reconnect before saving.");
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) router.push("/login");
      throw Object.assign(Error(body.error?.message || "The request failed."), {
        status: response.status,
      });
    }
    if (options.method && options.method !== "GET" && body?.data?.id) {
      const entity = url.split("/")[3];
      if (
        [
          "tasks",
          "projects",
          "goals",
          "milestones",
          "reviews",
          "courses",
          "assessments",
          "study_topics",
          "academic_terms",
        ].includes(entity)
      ) {
        accept(entity, body.data);
        knownWrite.current = true;
        confirmedReads.current.set(
          `${entity}:${body.data.id}`,
          `/api/v1/${entity}/${body.data.id}`,
        );
      }
    }
    return body;
  }
  async function refresh() {
    if (knownWrite.current) {
      knownWrite.current = false;
      await recover();
      return;
    }
    const sequence = ++readSequence.current,
      before = revision.current;
    const next = await request("/api/v1/workspace");
    if (sequence === readSequence.current && before === revision.current) {
      setData(
        (previous) =>
          keepConfirmedRows(
            next as unknown as Record<string, unknown>,
            previous as unknown as Record<string, unknown>,
            versions.current,
          ) as unknown as Workspace,
      );
      announceChange();
    }
  }
  async function mutate(
    entity: string,
    id: string | null,
    values: unknown,
    version?: number,
  ) {
    const signature = JSON.stringify([entity, id, values, version]);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(signature),
        ),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const storageKey = "lifeos:save:" + digest;
    let savedOperation: string | null = null;
    try {
      savedOperation = sessionStorage.getItem(storageKey);
    } catch {}
    const operation =
      operations.current.get(signature) ??
      savedOperation ??
      crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey, operation);
    } catch {}
    operations.current.set(signature, operation);
    const actionKey = entity + ":" + (id ?? "create");
    setPendingActions((previous) => ({
      ...previous,
      [actionKey]: (previous[actionKey] ?? 0) + 1,
    }));
    try {
      let body: { data: { id: string; version?: number } };
      try {
        body = (await request(`/api/v1/${entity}${id ? `/${id}` : ""}`, {
          method: id ? "PATCH" : "POST",
          headers: id ? {} : { "Idempotency-Key": operation },
          body: JSON.stringify(id ? { version, data: values } : values),
        })) as typeof body;
      } catch (error) {
        // A lost response is not evidence that the server rejected the write.
        if (
          error instanceof TypeError ||
          error instanceof SyntaxError ||
          (error &&
            typeof error === "object" &&
            "status" in error &&
            Number(error.status) >= 500)
        ) {
          try {
            const known = (await request(
              `/api/v1/${entity}/${id ?? operation}`,
            )) as typeof body;
            if (
              Object.entries(values as Record<string, unknown>).every(
                ([k, v]) =>
                  JSON.stringify((known.data as Record<string, unknown>)[k]) ===
                  JSON.stringify(v),
              )
            )
              body = known;
            else throw error;
          } catch {
            throw Error(
              "Save outcome unknown. Check the current record before retrying. Retry reuses the same save identifier; it will not create a second record.",
            );
          }
        } else throw error;
      }
      accept(entity, body.data);
      knownWrite.current = false;
      operations.current.delete(signature);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      confirmedReads.current.set(
        `${entity}:${body.data.id}`,
        `/api/v1/${entity}/${body.data.id}`,
      );
      void recover();
      return body;
    } finally {
      setPendingActions((previous) => ({
        ...previous,
        [actionKey]: Math.max(0, (previous[actionKey] ?? 1) - 1),
      }));
    }
  }

  return (
    <WorkspaceContext.Provider
      value={{ data, pending, isPending, mutate, refresh, notify, request }}
    >
      {children}
      <div className="feedback-stack">
        {refreshPending && (
          <div className="refresh-pending" role="status">
            Saved · refresh pending.{" "}
            <Button variant="ghost" size="sm" onClick={() => void recover()}>
              Retry refresh
            </Button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Info size={17} />
            <span>{notice.message}</span>
            {notice.undo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await notice.undo!();
                    setNotice(null);
                  } catch (e) {
                    setNotice({
                      message: e instanceof Error ? e.message : "Undo failed.",
                    });
                  }
                }}
              >
                Undo
              </Button>
            )}
            {notice.recovery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await notice.recovery!.action();
                    setNotice(null);
                  } catch {
                    /* The confirmed write stays saved; keep its retry action. */
                  }
                }}
              >
                {notice.recovery.label}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw Error("Workspace provider missing");
  return value;
}
