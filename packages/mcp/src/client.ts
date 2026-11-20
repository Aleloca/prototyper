import { normalizeServer, readCredentials, type ServerCredentials } from "./config.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** HTTP client for the Prototyper MCP API (`/api/v1`), authenticated as the signed-in user. */
export class Api {
  constructor(
    readonly server: string,
    private readonly creds: ServerCredentials,
  ) {}

  get user() {
    return { email: this.creds.email, name: this.creds.name };
  }

  /** For git over HTTP (sent as a header through the environment, never written to disk). */
  get token(): string {
    return this.creds.token;
  }

  /** The API for a server (or the default one). Env PROTOTYPER_SERVER / PROTOTYPER_TOKEN override the file. */
  static async connect(server?: string): Promise<Api> {
    if (process.env.PROTOTYPER_TOKEN && process.env.PROTOTYPER_SERVER) {
      return new Api(normalizeServer(process.env.PROTOTYPER_SERVER), { token: process.env.PROTOTYPER_TOKEN, email: "", name: "", expiresAt: "" });
    }
    const creds = await readCredentials();
    const url = server ? normalizeServer(server) : creds.default;
    if (!url) throw new Error("Not signed in to Prototyper. Use the login tool with the panel address (e.g. prototyper.example.com).");
    const c = creds.servers[url];
    if (!c) throw new Error(`Not signed in to ${url}. Use the login tool.`);
    if (Date.parse(c.expiresAt) < Date.now()) throw new Error(`The login to ${url} expired. Use the login tool again.`);
    return new Api(url, c);
  }

  async request<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
    const res = await fetch(this.server + path, {
      method,
      headers: { authorization: `Bearer ${this.creds.token}`, ...(body !== undefined ? { "content-type": contentType } : {}) },
      ...(body !== undefined ? { body: contentType === "application/json" ? JSON.stringify(body) : (body as Buffer as unknown as string) } : {}),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = (data as { error?: string }).error ?? text.slice(0, 200);
      if (res.status === 401) throw new ApiError(401, "The Prototyper login is not valid any more (expired, revoked or 2FA turned off). Use the login tool again.");
      throw new ApiError(res.status, `Prototyper: ${msg}`);
    }
    return data as T;
  }

  async download(path: string): Promise<Buffer> {
    const res = await fetch(this.server + path, { headers: { authorization: `Bearer ${this.creds.token}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

// Shapes returned by the server.
export interface SourceInfo {
  git: string | null;
  head: string | null;
}
export interface Workspace {
  id: string;
  name: string;
  domains: { id: string; hostname: string }[];
  clients: string[];
}
export interface Me {
  user: { email: string; name: string };
  workspaces: Workspace[];
}
export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  client: { name: string } | null;
  domain: { hostname: string } | null;
  url: string | null;
  shareStatus: string | null;
  latestVersion: { number: number; publishedAt: string; changelog: string } | null;
  round: { id: number; status: string; edits: number; comments: number; versionNumber: number | null } | null;
  updatedAt: string;
}
export type ContentValue =
  | { kind: "text"; text: string }
  | { kind: "rich"; html: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "bg"; src: string };
export interface Feedback {
  round: { id: number; versionNumber: number | null; status: "open" | "submitted" | "imported"; submittedAt: string | null; submittedBy: string | null };
  edits: { key: string; page: string; value: ContentValue; before: ContentValue | null; author: string }[];
  uploads: { id: string; key: string; url: string; width: number; height: number }[];
  comments: { id: string; page: string; anchor: { key?: string; selector?: string; x: number; y: number }; text: string; author: string; status: string; reply: string | null }[];
}
