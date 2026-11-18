/** Types shared by the main process, preload and renderer. */

export interface Settings {
  /** Root folder of the library (clients/…). */
  libraryRoot: string;
  /** Explicit path of the `claude` binary; auto-detected when empty. */
  claudePath?: string;
  /** Model alias passed to `claude --model`; CLI default when empty. */
  model?: string;
}

export interface ClaudeCheck {
  ok: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface ClientInfo {
  slug: string;
  name: string;
  website?: string;
  createdAt: string;
}

export type DemoStatus = "draft" | "in-review" | "feedback" | "approved" | "exported";

export interface VersionInfo {
  number: number;
  tag: string;
  createdAt: string;
  summary: string;
}

/** Persisted in `<demo>/prototyper.json`. */
export interface DemoMeta {
  id: string;
  slug: string;
  clientSlug: string;
  name: string;
  language: string;
  pages: string[];
  status: DemoStatus;
  createdAt: string;
  updatedAt: string;
  claudeSessionId?: string;
  /** Cumulative cost reported by the CLI for the current session, used to show per-run cost. */
  claudeSessionCostUsd?: number;
  /** Set while a proposed structure waits for approval. */
  pendingStructure?: string;
  versions: VersionInfo[];
}

export interface DemoRef {
  client: string;
  demo: string;
}

export interface DemoSummary extends DemoMeta {
  /** data: URL of the home page thumbnail, if any. */
  thumbnail?: string;
}

export interface LibraryClient extends ClientInfo {
  demos: DemoSummary[];
}

export interface NewClientInput {
  name: string;
  website?: string;
}

export interface NewDemoInput {
  client: string;
  name: string;
  language: string;
  pages: string[];
  brief: string;
  structureFirst: boolean;
}

export interface LintSummary {
  errors: number;
  warnings: number;
  report: string;
}

/** What the workspace needs to render a demo. */
export interface DemoDetail {
  meta: DemoMeta;
  clientName: string;
  dir: string;
  previewUrl: string;
  hasPages: boolean;
  running: boolean;
  /** Commits after the last version tag. */
  unsavedChanges: boolean;
  lint?: LintSummary;
}

export type RunPhase = "claude" | "lint-fix" | "build" | "lint" | "commit";

/** Streamed from main to renderer while a demo task runs; also persisted to the demo log. */
export type RunEvent =
  | { type: "user"; text: string; at: string }
  | { type: "phase"; phase: RunPhase; message: string; at: string }
  | { type: "assistant"; text: string; at: string }
  | { type: "tool"; name: string; detail: string; at: string }
  | { type: "result"; ok: boolean; text: string; costUsd?: number; durationMs?: number; at: string }
  | { type: "lint"; errors: number; warnings: number; report: string; at: string }
  | { type: "structure"; text: string; at: string }
  | { type: "version"; number: number; at: string }
  | { type: "error"; message: string; at: string }
  | { type: "done"; ok: boolean; at: string };

export interface DemoEventMessage {
  ref: DemoRef;
  event: RunEvent;
}
