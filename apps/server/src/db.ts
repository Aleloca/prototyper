import { DatabaseSync } from "node:sqlite";

export type ShareStatus = "open" | "readonly" | "revoked";
export type RoundStatus = "open" | "submitted" | "imported";
export type CommentStatus = "open" | "resolved" | "answered";
export type DomainStatus = "pending" | "active" | "error" | "disabled";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number;
  is_admin: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id_hash: string;
  user_id: string;
  /** `mfa`: password accepted, waiting for the TOTP code. `full`: signed in. */
  stage: "mfa" | "full";
  created_at: string;
  expires_at: string;
  user_agent: string;
}

export interface InviteRow {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

export interface DomainRow {
  id: string;
  workspace_id: string;
  hostname: string;
  status: DomainStatus;
  cert_expires_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ClientRow {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
  client_id: string;
  domain_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: number;
  project_id: string;
  number: number;
  changelog: string;
  dir: string;
  published_by: string;
  published_at: string;
}

export interface ShareRow {
  token: string;
  project_id: string;
  version_id: number;
  status: ShareStatus;
  created_at: string;
}

export interface RoundRow {
  id: number;
  project_id: string;
  version_id: number;
  status: RoundStatus;
  opened_at: string;
  submitted_at: string | null;
  submitted_by: string | null;
  imported_at: string | null;
}

export interface EditRow {
  id: number;
  round_id: number;
  key: string;
  page: string;
  value_json: string;
  author: string;
  updated_at: string;
}

export interface UploadRow {
  id: string;
  round_id: number;
  key: string;
  file: string;
  mime: string;
  width: number;
  height: number;
  created_at: string;
}

export interface CommentRow {
  id: string;
  round_id: number;
  page: string;
  anchor_json: string;
  text: string;
  author: string;
  status: CommentStatus;
  reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export interface OAuthCodeRow {
  code_hash: string;
  user_id: string;
  code_challenge: string;
  redirect_uri: string;
  client_name: string;
  expires_at: string;
  used_at: string | null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'pending',
  cert_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  dir TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES versions(id),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL,
  submitted_at TEXT,
  submitted_by TEXT,
  imported_at TEXT
);

CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  page TEXT NOT NULL,
  value_json TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (round_id, key)
);

CREATE TABLE IF NOT EXISTS edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT,
  author TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  page TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rounds_project ON rounds(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
`;

type Param = string | number | null;
const now = () => new Date().toISOString();

/** Thin data-access layer over node:sqlite (synchronous, single process). */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  one<T>(sql: string, ...params: Param[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: Param[]) {
    return this.db.prepare(sql).run(...params);
  }

  private depth = 0;
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN");
    this.depth++;
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }

  audit(userId: string | null, action: string, detail: Record<string, unknown> = {}, ip: string | null = null): void {
    this.run("INSERT INTO audit_log (at, user_id, action, detail_json, ip) VALUES (?, ?, ?, ?, ?)", now(), userId, action, JSON.stringify(detail), ip);
  }

  // --- users -------------------------------------------------------------------------------

  user(id: string): UserRow | undefined {
    return this.one("SELECT * FROM users WHERE id = ?", id);
  }

  userByEmail(email: string): UserRow | undefined {
    return this.one("SELECT * FROM users WHERE email = ?", email.trim());
  }

  users(): UserRow[] {
    return this.all("SELECT * FROM users ORDER BY created_at");
  }

  createUser(u: { id: string; email: string; name?: string; isAdmin?: boolean }): UserRow {
    this.run("INSERT INTO users (id, email, name, is_admin, created_at) VALUES (?, ?, ?, ?, ?)", u.id, u.email.trim().toLowerCase(), u.name ?? "", u.isAdmin ? 1 : 0, now());
    return this.user(u.id)!;
  }

  updateUser(
    id: string,
    patch: Partial<Pick<UserRow, "name" | "password_hash" | "totp_secret" | "totp_enabled" | "totp_last_step" | "is_admin" | "disabled" | "last_login_at">>,
  ): UserRow {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      this.run(`UPDATE users SET ${k} = ? WHERE id = ?`, v as Param, id);
    }
    return this.user(id)!;
  }

  // --- sessions ----------------------------------------------------------------------------

  createSession(s: SessionRow): void {
    this.run(
      "INSERT INTO sessions (id_hash, user_id, stage, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
      s.id_hash,
      s.user_id,
      s.stage,
      s.created_at,
      s.expires_at,
      s.user_agent,
    );
  }

  session(idHash: string): SessionRow | undefined {
    return this.one("SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?", idHash, now());
  }

  updateSession(idHash: string, patch: { stage?: "full"; expires_at?: string }): void {
    if (patch.stage) this.run("UPDATE sessions SET stage = ? WHERE id_hash = ?", patch.stage, idHash);
    if (patch.expires_at) this.run("UPDATE sessions SET expires_at = ? WHERE id_hash = ?", patch.expires_at, idHash);
  }

  deleteSession(idHash: string): void {
    this.run("DELETE FROM sessions WHERE id_hash = ?", idHash);
  }

  deleteSessionsOf(userId: string, except?: string): void {
    this.run("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?", userId, except ?? "");
  }

  // --- invites -----------------------------------------------------------------------------

  createInvite(tokenHash: string, userId: string, expiresAt: string): void {
    this.run("UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now(), userId);
    this.run("INSERT INTO invites (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", tokenHash, userId, now(), expiresAt);
  }

  invite(tokenHash: string): InviteRow | undefined {
    return this.one("SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, now());
  }

  useInvite(tokenHash: string): void {
    this.run("UPDATE invites SET used_at = ? WHERE token_hash = ?", now(), tokenHash);
  }

  pendingInvite(userId: string): InviteRow | undefined {
    return this.one("SELECT * FROM invites WHERE user_id = ? AND used_at IS NULL AND expires_at > ?", userId, now());
  }

  // --- workspaces --------------------------------------------------------------------------

  workspace(id: string): WorkspaceRow | undefined {
    return this.one("SELECT * FROM workspaces WHERE id = ?", id);
  }

  workspaces(): WorkspaceRow[] {
    return this.all("SELECT * FROM workspaces ORDER BY name COLLATE NOCASE");
  }

  /** The workspaces a user can see: all of them for admins, their memberships otherwise. */
  workspacesOf(user: UserRow): WorkspaceRow[] {
    if (user.is_admin) return this.workspaces();
    return this.all(
      "SELECT w.* FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.name COLLATE NOCASE",
      user.id,
    );
  }

  createWorkspace(id: string, name: string): WorkspaceRow {
    this.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", id, name, now());
    return this.workspace(id)!;
  }

  renameWorkspace(id: string, name: string): WorkspaceRow {
    this.run("UPDATE workspaces SET name = ? WHERE id = ?", name, id);
    return this.workspace(id)!;
  }

  deleteWorkspace(id: string): void {
    this.run("DELETE FROM workspaces WHERE id = ?", id);
  }

  members(workspaceId: string): UserRow[] {
    return this.all(
      "SELECT u.* FROM users u JOIN workspace_members m ON m.user_id = u.id WHERE m.workspace_id = ? ORDER BY u.email",
      workspaceId,
    );
  }

  memberships(userId: string): string[] {
    return this.all<{ workspace_id: string }>("SELECT workspace_id FROM workspace_members WHERE user_id = ?", userId).map((r) => r.workspace_id);
  }

  isMember(workspaceId: string, userId: string): boolean {
    return !!this.one("SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?", workspaceId, userId);
  }

  addMember(workspaceId: string, userId: string): void {
    this.run("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, added_at) VALUES (?, ?, ?)", workspaceId, userId, now());
  }

  removeMember(workspaceId: string, userId: string): void {
    this.run("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", workspaceId, userId);
  }

  // --- domains -----------------------------------------------------------------------------

  domain(id: string): DomainRow | undefined {
    return this.one("SELECT * FROM domains WHERE id = ?", id);
  }

  domainByHost(hostname: string): DomainRow | undefined {
    return this.one("SELECT * FROM domains WHERE hostname = ?", hostname.toLowerCase());
  }

  domains(workspaceId?: string): DomainRow[] {
    return workspaceId
      ? this.all("SELECT * FROM domains WHERE workspace_id = ? ORDER BY hostname", workspaceId)
      : this.all("SELECT * FROM domains ORDER BY hostname");
  }

  createDomain(id: string, workspaceId: string, hostname: string): DomainRow {
    this.run("INSERT INTO domains (id, workspace_id, hostname, status, created_at) VALUES (?, ?, ?, 'pending', ?)", id, workspaceId, hostname.toLowerCase(), now());
    return this.domain(id)!;
  }

  updateDomain(id: string, patch: Partial<Pick<DomainRow, "status" | "cert_expires_at" | "last_error" | "workspace_id">>): DomainRow {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      this.run(`UPDATE domains SET ${k} = ? WHERE id = ?`, v as Param, id);
    }
    return this.domain(id)!;
  }

  deleteDomain(id: string): void {
    this.run("DELETE FROM domains WHERE id = ?", id);
  }

  // --- clients -----------------------------------------------------------------------------

  client(id: string): ClientRow | undefined {
    return this.one("SELECT * FROM clients WHERE id = ?", id);
  }

  clients(workspaceId: string): ClientRow[] {
    return this.all("SELECT * FROM clients WHERE workspace_id = ? ORDER BY name", workspaceId);
  }

  /** Find a client by name in a workspace (case-insensitive), creating it if needed. */
  ensureClient(id: string, workspaceId: string, name: string): ClientRow {
    const existing = this.one<ClientRow>("SELECT * FROM clients WHERE workspace_id = ? AND name = ?", workspaceId, name.trim());
    if (existing) return existing;
    this.run("INSERT INTO clients (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)", id, workspaceId, name.trim(), now());
    return this.client(id)!;
  }

  renameClient(id: string, name: string): ClientRow {
    this.run("UPDATE clients SET name = ? WHERE id = ?", name.trim(), id);
    return this.client(id)!;
  }

  deleteClientIfEmpty(id: string): void {
    this.run("DELETE FROM clients WHERE id = ? AND NOT EXISTS (SELECT 1 FROM projects WHERE client_id = ?)", id, id);
  }

  // --- projects & versions -------------------------------------------------------------------

  project(id: string): ProjectRow | undefined {
    return this.one("SELECT * FROM projects WHERE id = ?", id);
  }

  projects(workspaceId: string): ProjectRow[] {
    return this.all("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC", workspaceId);
  }

  createProject(p: Omit<ProjectRow, "created_at" | "updated_at">): ProjectRow {
    this.run(
      "INSERT INTO projects (id, workspace_id, client_id, domain_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      p.id,
      p.workspace_id,
      p.client_id,
      p.domain_id,
      p.name,
      p.created_by,
      now(),
      now(),
    );
    return this.project(p.id)!;
  }

  updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "client_id" | "domain_id">>): ProjectRow {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      this.run(`UPDATE projects SET ${k} = ? WHERE id = ?`, v as Param, id);
    }
    this.touchProject(id);
    return this.project(id)!;
  }

  touchProject(id: string): void {
    this.run("UPDATE projects SET updated_at = ? WHERE id = ?", now(), id);
  }

  deleteProject(id: string): void {
    this.run("DELETE FROM projects WHERE id = ?", id);
  }

  addVersion(projectId: string, number: number, changelog: string, dir: string, publishedBy: string): VersionRow {
    this.run(
      "INSERT INTO versions (project_id, number, changelog, dir, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)",
      projectId,
      number,
      changelog,
      dir,
      publishedBy,
      now(),
    );
    this.touchProject(projectId);
    return this.one("SELECT * FROM versions WHERE project_id = ? AND number = ?", projectId, number)!;
  }

  version(id: number): VersionRow | undefined {
    return this.one("SELECT * FROM versions WHERE id = ?", id);
  }

  versions(projectId: string): VersionRow[] {
    return this.all("SELECT * FROM versions WHERE project_id = ? ORDER BY number", projectId);
  }

  latestVersion(projectId: string): VersionRow | undefined {
    return this.one("SELECT * FROM versions WHERE project_id = ? ORDER BY number DESC LIMIT 1", projectId);
  }

  // --- shares -----------------------------------------------------------------------------

  share(token: string): ShareRow | undefined {
    return this.one("SELECT * FROM shares WHERE token = ?", token);
  }

  shareForProject(projectId: string): ShareRow | undefined {
    return this.one("SELECT * FROM shares WHERE project_id = ?", projectId);
  }

  createShare(token: string, projectId: string, versionId: number): ShareRow {
    this.run("INSERT INTO shares (token, project_id, version_id, status, created_at) VALUES (?, ?, ?, 'open', ?)", token, projectId, versionId, now());
    return this.share(token)!;
  }

  updateShare(token: string, patch: { versionId?: number; status?: ShareStatus; token?: string }): ShareRow {
    if (patch.versionId !== undefined) this.run("UPDATE shares SET version_id = ? WHERE token = ?", patch.versionId, token);
    if (patch.status !== undefined) this.run("UPDATE shares SET status = ? WHERE token = ?", patch.status, token);
    if (patch.token !== undefined) {
      this.run("UPDATE shares SET token = ? WHERE token = ?", patch.token, token);
      return this.share(patch.token)!;
    }
    return this.share(token)!;
  }

  // --- rounds -----------------------------------------------------------------------------

  round(id: number): RoundRow | undefined {
    return this.one("SELECT * FROM rounds WHERE id = ?", id);
  }

  rounds(projectId: string): RoundRow[] {
    return this.all("SELECT * FROM rounds WHERE project_id = ? ORDER BY id", projectId);
  }

  /** The newest round for the project, i.e. the one the client currently works in. */
  currentRound(projectId: string): RoundRow | undefined {
    return this.one("SELECT * FROM rounds WHERE project_id = ? ORDER BY id DESC LIMIT 1", projectId);
  }

  openRound(projectId: string, versionId: number): RoundRow {
    const r = this.run("INSERT INTO rounds (project_id, version_id, status, opened_at) VALUES (?, ?, 'open', ?)", projectId, versionId, now());
    return this.round(Number(r.lastInsertRowid))!;
  }

  submitRound(id: number, author: string): RoundRow {
    this.run("UPDATE rounds SET status = 'submitted', submitted_at = ?, submitted_by = ? WHERE id = ? AND status != 'imported'", now(), author, id);
    const r = this.round(id)!;
    this.touchProject(r.project_id);
    return r;
  }

  markImported(id: number, replies: Record<string, { status: CommentStatus; reply?: string }>): RoundRow {
    this.transaction(() => {
      this.run("UPDATE rounds SET status = 'imported', imported_at = ? WHERE id = ?", now(), id);
      for (const [commentId, r] of Object.entries(replies)) {
        this.run("UPDATE comments SET status = ?, reply = ?, updated_at = ? WHERE id = ? AND round_id = ?", r.status, r.reply ?? null, now(), commentId, id);
      }
    });
    return this.round(id)!;
  }

  // --- edits ------------------------------------------------------------------------------

  edits(roundId: number): EditRow[] {
    return this.all("SELECT * FROM edits WHERE round_id = ? ORDER BY updated_at", roundId);
  }

  putEdit(roundId: number, key: string, page: string, valueJson: string, author: string): void {
    this.transaction(() => {
      this.run(
        `INSERT INTO edits (round_id, key, page, value_json, author, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(round_id, key) DO UPDATE SET page = excluded.page, value_json = excluded.value_json, author = excluded.author, updated_at = excluded.updated_at`,
        roundId,
        key,
        page,
        valueJson,
        author,
        now(),
      );
      this.run("INSERT INTO edit_history (round_id, key, value_json, author, at) VALUES (?, ?, ?, ?, ?)", roundId, key, valueJson, author, now());
    });
  }

  deleteEdit(roundId: number, key: string, author: string): void {
    this.transaction(() => {
      this.run("DELETE FROM edits WHERE round_id = ? AND key = ?", roundId, key);
      this.run("INSERT INTO edit_history (round_id, key, value_json, author, at) VALUES (?, ?, NULL, ?, ?)", roundId, key, author, now());
    });
  }

  // --- uploads ----------------------------------------------------------------------------

  addUpload(u: Omit<UploadRow, "created_at">): UploadRow {
    this.run(
      "INSERT INTO uploads (id, round_id, key, file, mime, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      u.id,
      u.round_id,
      u.key,
      u.file,
      u.mime,
      u.width,
      u.height,
      now(),
    );
    return this.upload(u.id)!;
  }

  upload(id: string): UploadRow | undefined {
    return this.one("SELECT * FROM uploads WHERE id = ?", id);
  }

  uploads(roundId: number): UploadRow[] {
    return this.all("SELECT * FROM uploads WHERE round_id = ? ORDER BY created_at", roundId);
  }

  uploadsOfProject(projectId: string): UploadRow[] {
    return this.all("SELECT u.* FROM uploads u JOIN rounds r ON r.id = u.round_id WHERE r.project_id = ?", projectId);
  }

  // --- comments ---------------------------------------------------------------------------

  comments(roundId: number): CommentRow[] {
    return this.all("SELECT * FROM comments WHERE round_id = ? ORDER BY created_at", roundId);
  }

  comment(id: string): CommentRow | undefined {
    return this.one("SELECT * FROM comments WHERE id = ?", id);
  }

  addComment(c: Pick<CommentRow, "id" | "round_id" | "page" | "anchor_json" | "text" | "author">): CommentRow {
    this.run(
      "INSERT INTO comments (id, round_id, page, anchor_json, text, author, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      c.id,
      c.round_id,
      c.page,
      c.anchor_json,
      c.text,
      c.author,
      now(),
      now(),
    );
    return this.comment(c.id)!;
  }

  updateComment(id: string, text: string): CommentRow {
    this.run("UPDATE comments SET text = ?, updated_at = ? WHERE id = ?", text, now(), id);
    return this.comment(id)!;
  }

  deleteComment(id: string): void {
    this.run("DELETE FROM comments WHERE id = ?", id);
  }

  // --- API tokens & OAuth codes -----------------------------------------------------------------

  createApiToken(t: Omit<ApiTokenRow, "created_at" | "last_used_at" | "revoked_at">): ApiTokenRow {
    this.run(
      "INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      t.id,
      t.user_id,
      t.name,
      t.token_hash,
      now(),
      t.expires_at,
    );
    return this.one("SELECT * FROM api_tokens WHERE id = ?", t.id)!;
  }

  apiTokenByHash(hash: string): ApiTokenRow | undefined {
    return this.one("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?", hash, now());
  }

  apiTokens(userId: string): ApiTokenRow[] {
    return this.all("SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC", userId, now());
  }

  touchApiToken(id: string): void {
    this.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", now(), id);
  }

  revokeApiToken(id: string, userId: string): boolean {
    return this.run("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", now(), id, userId).changes > 0;
  }

  revokeApiTokensOf(userId: string): void {
    this.run("UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now(), userId);
  }

  createOAuthCode(c: Omit<OAuthCodeRow, "used_at">): void {
    this.run(
      "INSERT INTO oauth_codes (code_hash, user_id, code_challenge, redirect_uri, client_name, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.code_hash,
      c.user_id,
      c.code_challenge,
      c.redirect_uri,
      c.client_name,
      c.expires_at,
    );
  }

  /** Atomically consume an OAuth code: returns it only the first time, and only while valid. */
  consumeOAuthCode(hash: string): OAuthCodeRow | undefined {
    const row = this.one<OAuthCodeRow>("SELECT * FROM oauth_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?", hash, now());
    if (!row) return undefined;
    if (this.run("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL", now(), hash).changes === 0) return undefined;
    return row;
  }
}
