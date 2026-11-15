"use client";
import { createContext, useContext, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import type { Workspace } from "@/lib/schemas";
import { Button } from "./ui/button";
type Notice = { message: string; undo?: () => Promise<void> };
type Context = {
  data: Workspace;
  pending: boolean;
  mutate: (
    entity: string,
    id: string | null,
    values: unknown,
    version?: number,
  ) => Promise<unknown>;
  refresh: () => Promise<void>;
  notify: (message: string, undo?: () => Promise<void>) => void;
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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const router = useRouter();
  const notify = useCallback((message: string, undo?: () => Promise<void>) => {
    setNotice({ message, undo });
  }, []);
  async function request(url: string, options: RequestInit = {}) {
    if (typeof navigator !== "undefined" && !navigator.onLine)
      throw Error(
        "You’re offline. Your draft is kept; reconnect before saving.",
      );
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) router.push("/login");
      throw Error(body.error?.message || "The request failed.");
    }
    return body;
  }
  async function refresh() {
    const next = await request("/api/v1/workspace");
    setData(next as Workspace);
    window.dispatchEvent(new Event("lifeos:changed"));
  }
  async function mutate(
    entity: string,
    id: string | null,
    values: unknown,
    version?: number,
  ) {
    setPending(true);
    try {
      const body = await request(`/api/v1/${entity}${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(id ? { version, data: values } : values),
      });
      await refresh();
      return body;
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceContext.Provider
      value={{ data, pending, mutate, refresh, notify, request }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
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
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw Error("Workspace provider missing");
  return value;
}
