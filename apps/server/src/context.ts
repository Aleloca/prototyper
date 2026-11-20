import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import * as tar from "tar";
import { lintDemo, readSite, type ContentEntry, type LintIssue } from "@prototyper/shared";
import type { CommentRow, CommentStatus, ProjectRow, RoundRow, Store, UserRow, VersionRow } from "./db.js";
import { SecretBox } from "./security.js";
import type { Thumbnails } from "./thumbnails.js";
import type { GitRepos } from "./git.js";

export interface ServerConfig {
  dataDir: string;
  /** Secret used to encrypt TOTP secrets and sign preview URLs (32+ chars). */
  secretKey: string;
  /** Hostname of the panel (and of the MCP API and OAuth). Review links are never served there. */
  panelHost: string;
  /** Contents of the overlay bundle served at /__pt/review.js. */
  overlayJs: string;
  /** Folder with the built panel SPA (index.html + assets). */
  panelDir?: string;
  trustProxy?: boolean;
  logger?: boolean;
  /** Automatic certificates for preview domains (production). Absent: domains are activated by hand. */
  acme?: { certsDir: string; staging?: boolean; email?: string };
  /** Screenshot each version for the panel's cards (needs Chromium on the server). */
  thumbnails?: boolean;
  /** Development only: serve everything over plain http on this port (URLs become http://host:port). */
  devPort?: number;
  /** Keep each project's sources in an internal git repository (default on; needs git on the server). */
  git?: boolean;
  /** Standalone mode: the app itself serves HTTPS with these options (certificates picked by SNI). */
  https?: import("node:https").ServerOptions;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

export const hostOf = (req: FastifyRequest) => req.hostname.toLowerCase().replace(/:\d+$/, "");

/** Shared state and operations used by the panel API, the MCP API and the review routes. */
export class Ctx {
  readonly box: SecretBox;
  /** Screenshots for the panel's cards (absent in tests and when disabled). */
  thumbnails: Thumbnails | undefined;
  /** Project sources (internal git); absent when git isn't installed. */
  git: GitRepos | undefined;
  private readonly contentCache = new Map<number, Map<string, ContentEntry>>();

  constructor(
    readonly store: Store,
    readonly config: ServerConfig,
  ) {
    this.box = new SecretBox(config.secretKey);
  }

  get panelOrigin(): string {
    return this.originOf(this.config.panelHost);
  }

  /** `https://host`, or `http://host:port` in development. */
  originOf(host: string): string {
    return this.config.devPort ? `http://${host}:${this.config.devPort}` : `https://${host}`;
  }

  // --- access --------------------------------------------------------------------------------

  canAccessWorkspace(user: UserRow, workspaceId: string): boolean {
    return !!user.is_admin || this.store.isMember(workspaceId, user.id);
  }

  workspaceFor(user: UserRow, workspaceId: string) {
    const w = this.store.workspace(workspaceId);
    if (!w || !this.canAccessWorkspace(user, w.id)) throw httpError(404, "unknown_workspace");
    return w;
  }

  projectFor(user: UserRow, projectId: string): ProjectRow {
    const p = this.store.project(projectId);
    if (!p || !this.canAccessWorkspace(user, p.workspace_id)) throw httpError(404, "unknown_project");
    return p;
  }

  roundFor(user: UserRow, roundId: number): RoundRow {
    const r = this.store.round(roundId);
    if (!r) throw httpError(404, "unknown_round");
    this.projectFor(user, r.project_id);
    return r;
  }

  // --- content -------------------------------------------------------------------------------

  async versionContent(v: VersionRow): Promise<Map<string, ContentEntry>> {
    let c = this.contentCache.get(v.id);
    if (!c) {
      c = lintDemo(await readSite(v.dir)).content;
      this.contentCache.set(v.id, c);
    }
    return c;
  }

  shareUrl(project: ProjectRow): string | null {
    const share = this.store.shareForProject(project.id);
    const domain = project.domain_id ? this.store.domain(project.domain_id) : undefined;
    if (!share || !domain) return null;
    return `${this.originOf(domain.hostname)}/s/${share.token}/`;
  }

  /** Signed, expiring URL of one version on the project's preview domain (no overlay, read-only). */
  versionPreviewUrl(project: ProjectRow, version: VersionRow, ttlSeconds = 6 * 3600): string | null {
    const domain = project.domain_id ? this.store.domain(project.domain_id) : undefined;
    if (!domain) return null;
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${version.id}.${exp}`;
    return `${this.originOf(domain.hostname)}/v/${payload}.${this.box.sign(`version:${payload}`)}/`;
  }

  checkVersionSignature(id: number, exp: number, sig: string): boolean {
    return exp > Date.now() / 1000 && this.box.sign(`version:${id}.${exp}`) === sig;
  }

  // --- DTOs ----------------------------------------------------------------------------------

  roundDto(r: RoundRow) {
    return {
      id: r.id,
      versionNumber: this.store.version(r.version_id)?.number ?? null,
      status: r.status,
      openedAt: r.opened_at,
      submittedAt: r.submitted_at,
      submittedBy: r.submitted_by,
      importedAt: r.imported_at,
    };
  }

  roundSummary(r: RoundRow) {
    return { ...this.roundDto(r), edits: this.store.edits(r.id).length, comments: this.store.comments(r.id).length };
  }

  projectSummary(p: ProjectRow) {
    const s = this.store;
    const client = s.client(p.client_id);
    const domain = p.domain_id ? s.domain(p.domain_id) : undefined;
    const share = s.shareForProject(p.id);
    const latest = s.latestVersion(p.id);
    const round = s.currentRound(p.id);
    return {
      id: p.id,
      name: p.name,
      workspaceId: p.workspace_id,
      client: client ? { id: client.id, name: client.name, swatch: client.swatch } : null,
      /** The project's number among its client's projects, by creation (the swatch code). */
      number: s.one<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE client_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?))", p.client_id, p.created_at, p.created_at, p.id)?.n ?? 1,
      domain: domain ? { id: domain.id, hostname: domain.hostname, status: domain.status } : null,
      url: this.shareUrl(p),
      shareStatus: share?.status ?? null,
      latestVersion: latest ? { number: latest.number, publishedAt: latest.published_at, changelog: latest.changelog } : null,
      thumbnail: latest && this.thumbnails && existsSync(this.thumbnails.path(latest.id)) ? `/api/panel/thumbs/${latest.id}` : null,
      round: round ? this.roundSummary(round) : null,
      createdBy: s.user(p.created_by)?.name || s.user(p.created_by)?.email || null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  projectDetail(p: ProjectRow) {
    return {
      ...this.projectSummary(p),
      versions: this.store
        .versions(p.id)
        .reverse()
        .map((v) => ({
          id: v.id,
          number: v.number,
          changelog: v.changelog,
          publishedAt: v.published_at,
          publishedBy: this.store.user(v.published_by)?.name || this.store.user(v.published_by)?.email || null,
          previewUrl: this.versionPreviewUrl(p, v),
          commit: v.commit_sha,
          source: v.commit_sha ? `/api/panel/versions/${v.id}/source.zip` : null,
        })),
      rounds: this.store
        .rounds(p.id)
        .reverse()
        .map((r) => this.roundSummary(r)),
    };
  }

  async feedback(round: RoundRow, uploadUrl: (id: string) => string) {
    const version = this.store.version(round.version_id)!;
    const content = await this.versionContent(version);
    return {
      round: this.roundDto(round),
      edits: this.store.edits(round.id).map((e) => ({
        key: e.key,
        page: e.page,
        value: JSON.parse(e.value_json) as unknown,
        before: content.get(e.key)?.value ?? null,
        author: e.author,
        updatedAt: e.updated_at,
      })),
      uploads: this.store.uploads(round.id).map((u) => ({ id: u.id, key: u.key, mime: u.mime, width: u.width, height: u.height, url: uploadUrl(u.id) })),
      comments: this.store.comments(round.id).map(commentDto),
    };
  }

  // --- operations ----------------------------------------------------------------------------

  createProject(user: UserRow, input: { workspaceId: string; client: string; name: string; domainId?: string | undefined }): ProjectRow {
    this.workspaceFor(user, input.workspaceId);
    const domainId = this.pickDomain(input.workspaceId, input.domainId);
    return this.store.transaction(() => {
      const client = this.store.ensureClient(randomUUID(), input.workspaceId, input.client);
      return this.store.createProject({
        id: randomUUID(),
        workspace_id: input.workspaceId,
        client_id: client.id,
        domain_id: domainId,
        name: input.name.trim(),
        created_by: user.id,
      });
    });
  }

  /** A domain of the workspace: the one asked for (must belong to it), or the first active one. */
  pickDomain(workspaceId: string, domainId?: string): string | null {
    const domains = this.store.domains(workspaceId);
    if (domainId) {
      const d = domains.find((x) => x.id === domainId || x.hostname === domainId.toLowerCase());
      if (!d) throw httpError(400, "unknown_domain");
      return d.id;
    }
    return domains.find((d) => d.status === "active")?.id ?? null;
  }

  /**
   * Publish a new version of a project from a tar.gz of the built site, point the review link to it
   * (creating the link the first time) and open a new review round.
   */
  async publishVersion(user: UserRow, project: ProjectRow, tarball: Buffer, changelog: string, commit?: string) {
    if (commit && !(this.git && (await this.git.onMain(project.id, commit)))) {
      throw httpError(400, "commit_not_pushed: push the sources to the project's git before publishing this commit");
    }
    if (!project.domain_id) {
      const domainId = this.pickDomain(project.workspace_id);
      if (!domainId) throw httpError(409, "no_preview_domain");
      project = this.store.updateProject(project.id, { domain_id: domainId });
    }
    const number = (this.store.latestVersion(project.id)?.number ?? 0) + 1;
    const dir = join(this.config.dataDir, "projects", project.id, `v${number}`);
    const tmp = `${dir}.tmp-${randomUUID()}`;
    await mkdir(tmp, { recursive: true });
    let issues: LintIssue[];
    try {
      await extractTarball(tarball, tmp);
      const site = await readSite(tmp);
      if (!site.pages.some((p) => p.path === "index.html")) throw httpError(400, "index.html missing at the root of the site");
      issues = lintDemo(site).issues;
      await rm(dir, { recursive: true, force: true });
      await rename(tmp, dir);
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw e;
    }
    const version = this.store.transaction(() => {
      const v = this.store.addVersion(project.id, number, changelog, dir, user.id, commit ?? null);
      const share = this.store.shareForProject(project.id);
      if (share) this.store.updateShare(share.token, { versionId: v.id });
      else this.store.createShare(randomBytes(32).toString("base64url"), project.id, v.id);
      this.store.openRound(project.id, v.id);
      return v;
    });
    this.store.audit(user.id, "version.publish", { project: project.id, number, ...(commit ? { commit } : {}) });
    if (commit) await this.git?.tag(project.id, number, commit).catch(() => {});
    this.thumbnails?.request(version.id);
    return {
      version: { id: version.id, number: version.number, publishedAt: version.published_at },
      url: this.shareUrl(this.store.project(project.id)!),
      warnings: issues.filter((i) => i.severity === "warning").length,
      errors: issues.filter((i) => i.severity === "error").map((i) => `${i.page}: ${i.message}`).slice(0, 50),
    };
  }

  importRound(user: UserRow, round: RoundRow, replies: Record<string, { status: CommentStatus; reply?: string | undefined }>) {
    const r = this.store.markImported(round.id, replies);
    this.store.audit(user.id, "round.import", { round: round.id });
    return this.roundDto(r);
  }

  async deleteProject(user: UserRow, project: ProjectRow): Promise<void> {
    const uploads = this.store.uploadsOfProject(project.id);
    this.store.deleteProject(project.id);
    this.store.deleteClientIfEmpty(project.client_id);
    await rm(join(this.config.dataDir, "projects", project.id), { recursive: true, force: true });
    await this.git?.remove(project.id);
    for (const u of uploads) await rm(u.file, { force: true });
    this.store.audit(user.id, "project.delete", { project: project.id, name: project.name });
  }
}

/** Public shape of a comment (also used by the overlay). */
export function commentDto(c: CommentRow) {
  return {
    id: c.id,
    page: c.page,
    anchor: JSON.parse(c.anchor_json) as unknown,
    text: c.text,
    author: c.author,
    status: c.status,
    reply: c.reply,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

async function extractTarball(body: Buffer, dest: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const x = tar.x({
      cwd: dest,
      strict: true,
      // Only plain files and folders, never outside the destination.
      filter: (path, entry) => !path.split("/").some((p) => p === "..") && ("type" in entry ? entry.type === "File" || entry.type === "Directory" : true),
    });
    x.on("error", reject).on("close", resolve).on("finish", resolve);
    Readable.from(body).pipe(x);
  });
}

export const SAFE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function notFoundPage(reply: FastifyReply) {
  return reply
    .code(404)
    .headers(SAFE_HEADERS)
    .type("text/html; charset=utf-8")
    .send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#555">This link is not available.</body>');
}
