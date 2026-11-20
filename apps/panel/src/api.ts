/** Thin client for the panel API. Errors carry the server's message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/panel/login") && !url.startsWith("/api/panel/invites")) window.dispatchEvent(new Event("pt:signed-out"));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown = {}) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  totpEnabled: boolean;
  disabled: boolean;
}

export interface Me {
  user: User;
  workspaces: { id: string; name: string }[];
}

export interface RoundSummary {
  id: number;
  versionNumber: number | null;
  status: "open" | "submitted" | "imported";
  openedAt: string;
  submittedAt: string | null;
  submittedBy: string | null;
  importedAt: string | null;
  edits: number;
  comments: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  client: { id: string; name: string; swatch: number } | null;
  /** Number among the client's projects (swatch code). */
  number: number;
  domain: { id: string; hostname: string; status: string } | null;
  url: string | null;
  shareStatus: "open" | "readonly" | "revoked" | null;
  latestVersion: { number: number; publishedAt: string; changelog: string } | null;
  round: RoundSummary | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  versions: { id: number; number: number; changelog: string; publishedAt: string; publishedBy: string | null; previewUrl: string | null }[];
  rounds: RoundSummary[];
}

export type ContentValue =
  | { kind: "text"; text: string }
  | { kind: "rich"; html: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "bg"; src: string };

export interface Feedback {
  round: Omit<RoundSummary, "edits" | "comments">;
  edits: { key: string; page: string; value: ContentValue; before: ContentValue | null; author: string; updatedAt: string }[];
  uploads: { id: string; key: string; url: string; width: number; height: number }[];
  comments: {
    id: string;
    page: string;
    anchor: { key?: string; selector?: string; x: number; y: number };
    text: string;
    author: string;
    status: "open" | "resolved" | "answered";
    reply: string | null;
    createdAt: string;
  }[];
}

export interface WorkspaceView {
  workspace: { id: string; name: string };
  clients: { id: string; name: string; swatch: number }[];
  projects: ProjectSummary[];
  domains: { id: string; hostname: string; status: string }[];
  members: { id: string; name: string; email: string }[];
}
