import "server-only";

const CANVAS_ORIGIN = "https://canvas.sfu.ca";
const MAX_PAGES = 100;

export class CanvasApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CanvasApiError";
  }
}

export type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  enrollment_term_id?: number;
};

export type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url?: string;
  submission?: unknown;
};

export class CanvasClient {
  constructor(private readonly token: string) {
    if (!token.trim()) throw new Error("Canvas token is required");
  }

  async list<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const url = new URL("/api/v1/" + path.replace(/^\/+/, ""), CANVAS_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("per_page", "100");

    const records: T[] = [];
    let next: URL | null = url;
    const seen = new Set<string>();

    for (let page = 0; next && page < MAX_PAGES; page++) {
      const current: URL = next;
      if (seen.has(current.href)) throw new Error("Canvas pagination loop detected");
      seen.add(current.href);
      const response = await fetch(current.href, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new CanvasApiError(response.status, `Canvas request failed (${response.status})`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("Unexpected Canvas response");
      records.push(...(body as T[]));

      const link: string = response.headers.get("link") ?? "";
      const match: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      if (!match) return records;
      const candidate: URL = new URL(match[1], CANVAS_ORIGIN);
      if (candidate.origin !== CANVAS_ORIGIN || !candidate.pathname.startsWith("/api/v1/")) {
        throw new Error("Canvas returned an untrusted pagination URL");
      }
      next = candidate;
    }
    if (next) throw new Error("Canvas pagination limit exceeded");
    return records;
  }

  courses() {
    return this.list<CanvasCourse>("courses", { enrollment_state: "active" });
  }

  assignments(courseId: number) {
    return this.list<CanvasAssignment>(`courses/${courseId}/assignments`, {
      "include[]": "submission",
    });
  }

  modules(courseId: number) {
    return this.list<unknown>(`courses/${courseId}/modules`);
  }

  announcements(courseId: number) {
    return this.list<unknown>("announcements", { "context_codes[]": `course_${courseId}` });
  }
}
