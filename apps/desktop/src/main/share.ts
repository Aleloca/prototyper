import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import type { ContentValue, FeedbackAnchor, RoundSummary, ShareTarget } from "../common/types";

export interface ServerFeedback {
  round: { id: number; versionNumber: number; status: "open" | "submitted" | "imported"; submittedAt: string | null; submittedBy: string | null };
  edits: { key: string; page: string; value: ContentValue; before: ContentValue | null; author: string; updatedAt: string }[];
  uploads: { id: string; key: string; mime: string; width: number; height: number }[];
  comments: { id: string; page: string; anchor: FeedbackAnchor; text: string; author: string; status: string; reply: string | null; createdAt: string }[];
}

/** HTTP client for a Prototyper share server's admin API. */
export class ShareClient {
  constructor(
    private readonly target: ShareTarget,
    private readonly adminToken: string,
  ) {}

  get host(): string {
    return new URL(this.target.baseUrl).hostname.toLowerCase();
  }

  shareUrl(token: string): string {
    return `${this.target.baseUrl.replace(/\/+$/, "")}/s/${token}/`;
  }

  private async req<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.target.baseUrl.replace(/\/+$/, "") + path, {
        method,
        headers: { Authorization: `Bearer ${this.adminToken}`, ...(body !== undefined ? { "Content-Type": contentType } : {}) },
        body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : (body as unknown as BodyInit),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new Error(`Cannot reach ${this.target.baseUrl}: ${(e as Error).message}`);
    }
    if (res.status === 401) throw new Error(`The admin token for ${this.target.name} was rejected.`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${this.target.name}: ${method} ${path} failed (${res.status}) ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  health = () => this.req<{ ok: boolean }>("GET", "/api/admin/health");

  putProject = (id: string, name: string) => this.req("PUT", `/api/admin/projects/${id}`, { name });

  async uploadVersion(projectId: string, number: number, distDir: string, changelog: string): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of tar.c({ gzip: true, cwd: distDir, portable: true }, ["."]) as AsyncIterable<Buffer>) chunks.push(c);
    const qs = new URLSearchParams({ number: String(number), changelog });
    await this.req("POST", `/api/admin/projects/${projectId}/versions?${qs}`, Buffer.concat(chunks), "application/gzip");
  }

  putShare = (projectId: string) =>
    this.req<{ token: string; status: "open" | "readonly" | "revoked"; versionNumber: number }>("PUT", `/api/admin/projects/${projectId}/share`, { host: this.host });

  setShareStatus = (token: string, status: "open" | "readonly" | "revoked") => this.req("PATCH", `/api/admin/shares/${token}`, { status });

  rounds = (projectId: string) => this.req<RoundSummary[]>("GET", `/api/admin/projects/${projectId}/rounds`);

  feedback = (roundId: number) => this.req<ServerFeedback>("GET", `/api/admin/rounds/${roundId}/feedback`);

  async upload(id: string): Promise<Buffer> {
    const res = await fetch(`${this.target.baseUrl.replace(/\/+$/, "")}/api/admin/uploads/${id}`, {
      headers: { Authorization: `Bearer ${this.adminToken}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Download of image ${id} failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  markImported = (roundId: number, replies: Record<string, { status: "resolved" | "answered" | "open"; reply?: string }> = {}) =>
    this.req("POST", `/api/admin/rounds/${roundId}/imported`, { replies });
}

/** Text of the `## v<n>` section of a demo's CHANGELOG.md, if any. */
export async function changelogFor(demoDir: string, version: number): Promise<string> {
  const text = await readFile(join(demoDir, "CHANGELOG.md"), "utf8").catch(() => "");
  const m = new RegExp(`^##\\s*v${version}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m").exec(text);
  return m?.[1]?.trim() ?? "";
}
