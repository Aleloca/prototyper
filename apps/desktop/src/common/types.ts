/** Types shared by the main process, preload and renderer. */

export interface Settings {
  /** Root folder of the library (clients/…). */
  libraryRoot: string;
  /** Explicit path of the `claude` binary; auto-detected when empty. */
  claudePath?: string;
  /** Model alias passed to `claude --model`; CLI default when empty. */
  model?: string;
  /** Where demos can be published. Admin tokens are stored separately, encrypted. */
  shareTargets?: ShareTarget[];
}

/** A share server + public domain, e.g. https://preview.example.com. */
export interface ShareTarget {
  id: string;
  name: string;
  baseUrl: string;
}

export interface ShareTargetInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** Omit to keep the stored token. */
  adminToken?: string;
}

export interface ShareInfo {
  targetId: string;
  token: string;
  url: string;
  publishedVersion: number;
  publishedAt: string;
  status: "open" | "readonly" | "revoked";
}

export interface RoundSummary {
  id: number;
  versionNumber: number | null;
  status: "open" | "submitted" | "imported";
  submittedAt: string | null;
  submittedBy: string | null;
  edits: number;
  comments: number;
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
  share?: ShareInfo;
  /** Latest known review round on the share server (refreshed by polling). */
  lastRound?: RoundSummary;
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
  hasBrand: boolean;
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
  /** Local image files to add as references, with optional notes. */
  references?: { path: string; note: string }[];
}

/** Options for the first generation of a demo. */
export interface GenerateOptions {
  structureFirst: boolean;
  /** Extract the client's brand from their website before generating. */
  extractBrand?: boolean;
  /** Websites to capture as reference screenshots before generating. */
  referenceUrls?: string[];
}

/** Brand token values by CSS variable name, e.g. { "--color-primary": "#1f4fd6" }. */
export type BrandTokens = Record<string, string>;

export interface BrandInfo {
  client: string;
  clientName: string;
  website?: string;
  hasBrand: boolean;
  tokens: BrandTokens;
  brandMd: string;
  extractedAt?: string;
  pages?: string[];
  /** data URLs */
  logo?: string;
  screenshots: string[];
}

export interface BrandEventMessage {
  client: string;
  event: RunEvent;
}

export interface ReferenceItem {
  file: string;
  note: string;
  /** Website the screenshot was taken from, if any. */
  source?: string;
  addedAt: string;
  /** data URL thumbnail */
  thumbnail?: string;
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

export type RunPhase = "claude" | "lint-fix" | "build" | "lint" | "commit" | "brand" | "references";

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
  | { type: "published"; version: number; url: string; at: string }
  | { type: "feedback"; version: number; edits: number; notes: number; at: string }
  | { type: "error"; message: string; at: string }
  | { type: "done"; ok: boolean; at: string };

export interface DemoEventMessage {
  ref: DemoRef;
  event: RunEvent;
}

// --- client feedback ---------------------------------------------------------------------------

export type ContentValue =
  | { kind: "text"; text: string }
  | { kind: "rich"; html: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "bg"; src: string };

export interface FeedbackAnchor {
  key?: string;
  selector?: string;
  x: number;
  y: number;
  viewportWidth?: number;
}

export interface FeedbackEdit {
  key: string;
  page: string;
  value: ContentValue;
  before: ContentValue | null;
  author: string;
  updatedAt: string;
  /** For image/bg edits: data URL of the uploaded image (downloaded by the app). */
  preview?: string;
  /** For image/bg edits: data URL or preview URL of the original image. */
  beforePreview?: string;
}

export interface FeedbackNote {
  id: string;
  page: string;
  anchor: FeedbackAnchor;
  text: string;
  author: string;
  createdAt: string;
  /** Short description of what the note points at, e.g. the text of the anchored element. */
  context?: string;
  /** data URL of a screenshot of the commented area, when available. */
  screenshot?: string;
}

export interface FeedbackRound {
  roundId: number;
  versionNumber: number;
  status: "open" | "submitted" | "imported";
  submittedAt: string | null;
  submittedBy: string | null;
  edits: FeedbackEdit[];
  notes: FeedbackNote[];
}

export interface ApplyFeedbackInput {
  roundId: number;
  acceptedEdits: string[];
  acceptedNotes: string[];
  extraInstructions: string;
  /** Run Claude on the notes and save the next version; otherwise only apply the edits. */
  generate: boolean;
}
