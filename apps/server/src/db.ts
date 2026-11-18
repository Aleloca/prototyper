import { DatabaseSync } from "node:sqlite";

export type ShareStatus = "open" | "readonly" | "revoked";
export type RoundStatus = "open" | "submitted" | "imported";
export type CommentStatus = "open" | "resolved" | "answered";

export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

export interface VersionRow {
  id: number;
  project_id: string;
  number: number;
  changelog: string;
  dir: string;
  published_at: string;
}

export interface ShareRow {
  token: string;
  project_id: string;
  host: string | null;
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

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  dir TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  host TEXT,
  version_id INTEGER NOT NULL REFERENCES versions(id),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES versions(id),
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
`;

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

  private one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private all<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // --- projects & versions -----------------------------------------------------------------

  upsertProject(id: string, name: string): ProjectRow {
    this.run(
      "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      id,
      name,
      now(),
    );
    return this.project(id)!;
  }

  project(id: string): ProjectRow | undefined {
    return this.one("SELECT * FROM projects WHERE id = ?", id);
  }

  /** Insert or replace a version (re-publishing the same number replaces its files). */
  putVersion(projectId: string, number: number, changelog: string, dir: string): VersionRow {
    this.run(
      `INSERT INTO versions (project_id, number, changelog, dir, published_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, number) DO UPDATE SET changelog = excluded.changelog, dir = excluded.dir, published_at = excluded.published_at`,
      projectId,
      number,
      changelog,
      dir,
      now(),
    );
    return this.one("SELECT * FROM versions WHERE project_id = ? AND number = ?", projectId, number)!;
  }

  version(id: number): VersionRow | undefined {
    return this.one("SELECT * FROM versions WHERE id = ?", id);
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

  createShare(token: string, projectId: string, versionId: number, host: string | null): ShareRow {
    this.run(
      "INSERT INTO shares (token, project_id, host, version_id, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
      token,
      projectId,
      host,
      versionId,
      now(),
    );
    return this.share(token)!;
  }

  updateShare(token: string, patch: { host?: string | null; versionId?: number; status?: ShareStatus }): ShareRow {
    if (patch.host !== undefined) this.run("UPDATE shares SET host = ? WHERE token = ?", patch.host, token);
    if (patch.versionId !== undefined) this.run("UPDATE shares SET version_id = ? WHERE token = ?", patch.versionId, token);
    if (patch.status !== undefined) this.run("UPDATE shares SET status = ? WHERE token = ?", patch.status, token);
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
    return this.round(id)!;
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
}
