import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  SYSTEM_PROMPT,
  buildFromStructurePrompt,
  generatePrompt,
  lintFixPrompt,
  revisionPrompt,
} from "@prototyper/prototype-kit";
import type { ContentEdit } from "@prototyper/shared";
import type {
  ApplyFeedbackInput,
  DemoDetail,
  DemoMeta,
  DemoRef,
  FeedbackAnchor,
  FeedbackEdit,
  FeedbackNote,
  FeedbackRound,
  GenerateOptions,
  LintSummary,
  ReferenceItem,
  NewDemoInput,
  RoundSummary,
  RunEvent,
  RunPhase,
  Settings,
  ShareInfo,
} from "../common/types";
import { applyClientEdits, contentMap, describeValue, feedbackMarkdown, uploadIdOf } from "./feedback";
import { buildSite, lintSite } from "./build";
import { describeTool, findClaude, runClaude } from "./claude";
import type { BrandService } from "./brand";
import { DemoRepo } from "./git";
import { References } from "./references";
import { changelogFor, type ServerFeedback, type ShareClient } from "./share";
import type { Library } from "./library";
import type { PreviewServer } from "./preview";

const MAX_LINT_FIX_ATTEMPTS = 2;

export interface DemoServiceDeps {
  library: () => Library;
  settings: () => Settings;
  preview: PreviewServer;
  /** Streams an event to the renderer. */
  emit: (ref: DemoRef, event: RunEvent) => void;
  /** Tells the renderer to refetch the demo (files, meta or lint changed). */
  changed: (ref: DemoRef) => void;
  /** Captures a PNG thumbnail of `url` into `outPath` (needs Electron). */
  capture: (url: string, outPath: string) => Promise<void>;
  /** Admin API client for a configured share target. */
  shareClient?: (targetId: string) => ShareClient;
  /** Screenshot of the area a note points at, on a page of the local preview (needs Electron). */
  captureArea?: (pageUrl: string, anchor: FeedbackAnchor, outPath: string) => Promise<void>;
  /** System notification. */
  notify?: (ref: DemoRef, title: string, body: string) => void;
  brand?: BrandService;
  /** Full-page JPEG screenshot of a website, for references (needs Electron). */
  screenshotUrl?: (url: string) => Promise<Buffer>;
  /** Data-URL thumbnail of an image file (needs Electron). */
  thumbnail?: (file: string, width: number) => Promise<string | undefined>;
}

interface Running {
  abort: AbortController;
}

const now = () => new Date().toISOString();
const keyOf = (ref: DemoRef) => `${ref.client}--${ref.demo}`;

/** Orchestrates Claude runs, builds, lint, git and preview for each demo. */
export class DemoService {
  private readonly running = new Map<string, Running>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly lint = new Map<string, LintSummary>();

  constructor(private readonly deps: DemoServiceDeps) {}

  private dir(ref: DemoRef): string {
    return this.deps.library().demoDir(ref);
  }

  async create(input: NewDemoInput): Promise<DemoMeta> {
    const library = this.deps.library();
    const meta = await library.createDemo(input);
    const ref = { client: meta.clientSlug, demo: meta.slug };
    const dir = this.dir(ref);
    await this.useClientBrand(ref);
    const refs = this.references(ref);
    for (const r of input.references ?? []) await refs.addFile(r.path, r.note);
    const repo = new DemoRepo(dir);
    await repo.init();
    await repo.commitAll("Create demo");
    return meta;
  }

  /** Copy the client's brand tokens into the demo, if the client has a brand. Returns whether it did. */
  private async useClientBrand(ref: DemoRef): Promise<boolean> {
    const tokens = join(this.deps.library().brandDir(ref.client), "tokens.css");
    if (!(await stat(tokens).then(() => true, () => false))) return false;
    await copyFile(tokens, join(this.dir(ref), "src", "tokens.css"));
    return true;
  }

  // --- references -----------------------------------------------------------------------------

  private references(ref: DemoRef): References {
    return new References(this.dir(ref), this.deps.thumbnail);
  }

  listReferences = (ref: DemoRef): Promise<ReferenceItem[]> => this.references(ref).list();

  async addReferenceFiles(ref: DemoRef, paths: string[]): Promise<void> {
    for (const p of paths) await this.references(ref).addFile(p);
  }

  async addReferenceImage(ref: DemoRef, data: Uint8Array, ext: string): Promise<void> {
    const clean = `.${ext.replace(/^\./, "").toLowerCase()}`;
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(clean)) throw new Error("Unsupported image type.");
    await this.references(ref).addBuffer(Buffer.from(data), clean, "pasted");
  }

  async addReferenceUrl(ref: DemoRef, url: string, note = ""): Promise<void> {
    if (!this.deps.screenshotUrl) throw new Error("Screenshots are not available.");
    const u = new URL(url.trim().includes("://") ? url.trim() : `https://${url.trim()}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) addresses can be captured.");
    const jpg = await this.deps.screenshotUrl(u.toString());
    await this.references(ref).addBuffer(jpg, ".jpg", u.hostname.replace(/^www\./, ""), note, u.toString());
  }

  setReferenceNote = (ref: DemoRef, file: string, note: string) => this.references(ref).setNote(file, note);
  removeReference = (ref: DemoRef, file: string) => this.references(ref).remove(file);

  /** Extract the client's brand from a website (a client-level task, outside any demo). */
  async extractBrand(client: string, website: string, emit: (e: RunEvent) => void): Promise<boolean> {
    if (!this.deps.brand) throw new Error("Brand extraction is not available.");
    return this.deps.brand.extract(client, website, emit);
  }

  /** Steps run before the first generation: brand extraction and reference screenshots. */
  private async prepare(ref: DemoRef, opts: GenerateOptions, signal: AbortSignal): Promise<void> {
    if (opts.extractBrand && this.deps.brand) {
      const client = await this.deps.library().getClient(ref.client);
      if (client.website) {
        const ok = await this.deps.brand
          .extract(ref.client, client.website, (e) => (e.type === "phase" ? this.deps.emit(ref, e) : void this.record(ref, e)), signal)
          .catch(async (e: Error) => {
            await this.record(ref, { type: "error", message: `Brand extraction failed: ${e.message}. Continuing without it.`, at: now() });
            return false;
          });
        if (ok && (await this.useClientBrand(ref))) {
          await this.record(ref, { type: "assistant", text: `Using the brand extracted from ${client.website}.`, at: now() });
        }
      }
    }
    for (const url of opts.referenceUrls ?? []) {
      if (signal.aborted) return;
      this.phase(ref, "references", `Capturing ${url}…`);
      await this.addReferenceUrl(ref, url).catch((e: Error) => this.record(ref, { type: "error", message: `Could not capture ${url}: ${e.message}`, at: now() }));
    }
  }

  async detail(ref: DemoRef): Promise<DemoDetail> {
    const meta = await this.deps.library().readMeta(ref);
    const dir = this.dir(ref);
    const previewUrl = this.deps.preview.mount(keyOf(ref), join(dir, "dist"));
    const hasPages = await stat(join(dir, "src", "index.html")).then(() => true, () => false);
    const last = meta.versions.at(-1);
    const unsavedChanges = last ? (await new DemoRepo(dir).commitsSince(last.tag).catch(() => 0)) > 0 : hasPages;
    const lint = this.lint.get(keyOf(ref));
    const clientName = (await this.deps.library().getClient(ref.client)).name;
    return { meta, clientName, dir, previewUrl, hasPages, running: this.running.has(keyOf(ref)), unsavedChanges, ...(lint ? { lint } : {}) };
  }

  async log(ref: DemoRef): Promise<RunEvent[]> {
    const text = await readFile(join(this.dir(ref), ".prototyper", "log.jsonl"), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as RunEvent];
        } catch {
          return [];
        }
      });
  }

  /** Start watching `src/` so manual edits rebuild and reload the preview. */
  async open(ref: DemoRef): Promise<void> {
    const key = keyOf(ref);
    if (this.watchers.has(key)) return;
    const src = join(this.dir(ref), "src");
    await this.refreshLint(ref);
    void this.ensureThumbnail(ref);
    let timer: NodeJS.Timeout | undefined;
    try {
      const w = watch(src, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void this.rebuild(ref, { quiet: true }), 400);
      });
      this.watchers.set(key, w);
    } catch {
      /* src missing; nothing to watch */
    }
  }

  /** Demos generated outside the app (or before a crash) may have no thumbnail yet. */
  private async ensureThumbnail(ref: DemoRef): Promise<void> {
    const dir = this.dir(ref);
    const thumb = join(dir, ".prototyper", "thumb.png");
    const mtime = (p: string) => stat(p).then((s) => s.mtimeMs, () => 0);
    const built = await mtime(join(dir, "dist", "index.html"));
    // Missing, or older than the last build (e.g. the site changed outside the app).
    if (!built || (await mtime(thumb)) >= built) return;
    await mkdir(join(dir, ".prototyper"), { recursive: true });
    await this.deps.capture(this.deps.preview.mount(keyOf(ref), join(dir, "dist")), thumb).catch(() => {});
  }

  close(ref: DemoRef): void {
    const key = keyOf(ref);
    this.watchers.get(key)?.close();
    this.watchers.delete(key);
  }

  isRunning(ref: DemoRef): boolean {
    return this.running.has(keyOf(ref));
  }

  cancel(ref: DemoRef): void {
    this.running.get(keyOf(ref))?.abort.abort();
  }

  /** First generation. With `structureFirst`, Claude only proposes a structure to approve. */
  generate(ref: DemoRef, opts: GenerateOptions): Promise<void> {
    return this.task(ref, async (signal) => {
      await this.prepare(ref, opts, signal);
      if (signal.aborted) return false;
      const prompt = generatePrompt({ structureFirst: opts.structureFirst });
      const label = opts.structureFirst ? "Propose the site structure" : "Generate the site";
      const r = await this.claudeStep(ref, prompt, signal, label);
      if (!r.ok) return false;
      if (opts.structureFirst) {
        await this.deps.library().updateMeta(ref, (m) => void (m.pendingStructure = r.text));
        await this.record(ref, { type: "structure", text: r.text, at: now() });
        return true;
      }
      return this.finish(ref, signal, "Generate site", { firstVersion: true });
    });
  }

  approveStructure(ref: DemoRef, feedback: string): Promise<void> {
    return this.task(ref, async (signal) => {
      await this.deps.library().updateMeta(ref, (m) => void delete m.pendingStructure);
      const r = await this.claudeStep(ref, buildFromStructurePrompt(feedback), signal, feedback.trim() ? `Structure approved with changes:\n${feedback.trim()}` : "Structure approved");
      if (!r.ok) return false;
      return this.finish(ref, signal, "Generate site", { firstVersion: true });
    });
  }

  chat(ref: DemoRef, text: string): Promise<void> {
    return this.task(ref, async (signal) => {
      const r = await this.claudeStep(ref, text, signal, text);
      if (!r.ok) return false;
      const meta = await this.deps.library().readMeta(ref);
      return this.finish(ref, signal, `Claude: ${firstLine(text)}`, { firstVersion: meta.versions.length === 0 });
    });
  }

  async saveVersion(ref: DemoRef, summary: string): Promise<void> {
    const repo = new DemoRepo(this.dir(ref));
    const meta = await this.deps.library().readMeta(ref);
    const number = (meta.versions.at(-1)?.number ?? 0) + 1;
    const tag = `v${number}`;
    const text = summary.trim() || `Version ${number}`;
    // Record the version in meta first, so the tagged commit already contains it.
    await this.deps.library().updateMeta(ref, (m) => {
      m.versions.push({ number, tag, createdAt: now(), summary: text });
    });
    await repo.commitAll(`Version ${number}: ${text}`);
    await repo.tag(tag, text);
    await this.record(ref, { type: "version", number, at: now() });
    this.deps.changed(ref);
  }

  /**
   * Publish the latest saved version to a share target. The share link stays the same
   * across versions; each publish opens a new review round on the server.
   */
  async publish(ref: DemoRef, targetId: string): Promise<ShareInfo> {
    if (this.isRunning(ref)) throw new Error("Wait for Claude to finish before publishing.");
    const client = this.client(targetId);
    const detail = await this.detail(ref);
    const version = detail.meta.versions.at(-1);
    if (!version) throw new Error("Save a version before publishing.");
    if (detail.unsavedChanges) throw new Error(`There are changes after v${version.number}. Save a new version before publishing.`);

    await buildSite(detail.dir);
    await client.putProject(detail.meta.id, `${detail.clientName} — ${detail.meta.name}`);
    await client.uploadVersion(detail.meta.id, version.number, join(detail.dir, "dist"), (await changelogFor(detail.dir, version.number)) || version.summary);
    const share = await client.putShare(detail.meta.id);
    const info: ShareInfo = {
      targetId,
      token: share.token,
      url: client.shareUrl(share.token),
      publishedVersion: version.number,
      publishedAt: now(),
      status: share.status,
    };
    await this.deps.library().updateMeta(ref, (m) => {
      m.share = info;
      if (m.status === "draft" || m.status === "feedback") m.status = "in-review";
    });
    await this.record(ref, { type: "published", version: version.number, url: info.url, at: now() });
    this.deps.changed(ref);
    return info;
  }

  async setShareStatus(ref: DemoRef, status: ShareInfo["status"]): Promise<void> {
    const meta = await this.deps.library().readMeta(ref);
    if (!meta.share) throw new Error("This demo has not been shared yet.");
    await this.client(meta.share.targetId).setShareStatus(meta.share.token, status);
    await this.deps.library().updateMeta(ref, (m) => {
      if (m.share) m.share.status = status;
      if (status === "readonly" && m.status === "in-review") m.status = "approved";
    });
    this.deps.changed(ref);
  }

  async rounds(ref: DemoRef): Promise<RoundSummary[]> {
    const meta = await this.deps.library().readMeta(ref);
    if (!meta.share) return [];
    return this.client(meta.share.targetId).rounds(meta.id);
  }

  // --- client feedback --------------------------------------------------------------------------

  private roundDir(ref: DemoRef, versionNumber: number): string {
    return join(this.dir(ref), ".prototyper", "rounds", `v${versionNumber}`);
  }

  /** Download the newest review round that has not been imported yet, with its images. */
  async loadFeedback(ref: DemoRef): Promise<FeedbackRound> {
    const detail = await this.detail(ref);
    const share = detail.meta.share;
    if (!share) throw new Error("This demo has not been shared yet.");
    const client = this.client(share.targetId);
    const pending = (await client.rounds(detail.meta.id)).filter((r) => r.status !== "imported").at(-1);
    if (!pending) throw new Error("There is no new client feedback.");

    const fb = await client.feedback(pending.id);
    const dir = this.roundDir(ref, fb.round.versionNumber);
    await mkdir(join(dir, "uploads"), { recursive: true });
    await writeFile(join(dir, "feedback.json"), JSON.stringify(fb, null, 2));
    for (const u of fb.uploads) {
      const file = join(dir, "uploads", `${u.id}.webp`);
      if (!(await stat(file).then(() => true, () => false))) await writeFile(file, await client.upload(u.id));
    }

    const content = await contentMap(detail.dir);
    const pageUrl = (page: string) => new URL(page, detail.previewUrl).toString();
    const dataUrl = async (file: string, mime: string) =>
      readFile(file).then((b) => `data:${mime};base64,${b.toString("base64")}`, () => undefined);

    const edits: FeedbackEdit[] = [];
    for (const e of fb.edits) {
      const edit: FeedbackEdit = { ...e };
      if (e.value.kind === "image" || e.value.kind === "bg") {
        const id = uploadIdOf(e.value.src);
        const preview = id ? await dataUrl(join(dir, "uploads", `${id}.webp`), "image/webp") : undefined;
        if (preview) edit.preview = preview;
      }
      if (e.before && (e.before.kind === "image" || e.before.kind === "bg") && e.before.src) {
        edit.beforePreview = new URL(posix.join(posix.dirname(e.page), e.before.src), detail.previewUrl).toString();
      }
      edits.push(edit);
    }

    const notes: FeedbackNote[] = [];
    for (const c of fb.comments) {
      const note: FeedbackNote = { id: c.id, page: c.page, anchor: c.anchor, text: c.text, author: c.author, createdAt: c.createdAt };
      if (c.anchor.key) note.context = describeValue(content.get(c.anchor.key)?.value);
      const shot = join(dir, `note-${c.id}.png`);
      if (this.deps.captureArea && !(await stat(shot).then(() => true, () => false))) {
        await this.deps.captureArea(pageUrl(c.page), c.anchor, shot).catch(() => {});
      }
      const screenshot = await dataUrl(shot, "image/png");
      if (screenshot) note.screenshot = screenshot;
      notes.push(note);
    }

    return {
      roundId: fb.round.id,
      versionNumber: fb.round.versionNumber,
      status: fb.round.status,
      submittedAt: fb.round.submittedAt,
      submittedBy: fb.round.submittedBy,
      edits,
      notes,
    };
  }

  /**
   * Close the round on the server, apply the accepted edits to src/ and, when asked,
   * let Claude address the accepted notes and save the next version. Replies go back to the client.
   */
  applyFeedback(ref: DemoRef, input: ApplyFeedbackInput): Promise<void> {
    return this.task(ref, async (signal) => {
      const meta = await this.deps.library().readMeta(ref);
      if (!meta.share) throw new Error("This demo has not been shared yet.");
      const client = this.client(meta.share.targetId);
      const demoDir = this.dir(ref);

      const fb = await this.findRoundFeedback(ref, input.roundId);
      const versionNumber = fb.round.versionNumber;
      const dir = this.roundDir(ref, versionNumber);
      const accepted = fb.edits.filter((e) => input.acceptedEdits.includes(e.key));
      const notes = fb.comments.filter((c) => input.acceptedNotes.includes(c.id));
      await this.record(ref, {
        type: "user",
        text: `Apply client feedback on v${versionNumber}: ${accepted.length} of ${fb.edits.length} edits, ${notes.length} of ${fb.comments.length} notes${input.extraInstructions.trim() ? `\n\n${input.extraInstructions.trim()}` : ""}`,
        at: now(),
      });

      // The client can no longer change this round while we work on the next version.
      await client.markImported(fb.round.id);

      this.phase(ref, "build", "Applying the client's edits…");
      const edits: ContentEdit[] = accepted.map((e) => ({ key: e.key, value: e.value }) as ContentEdit);
      const result = await applyClientEdits(demoDir, edits, join(dir, "uploads"));
      if (result.unmatched.length || result.conflicts.length) {
        await this.record(ref, {
          type: "error",
          message: `Some edits could not be applied (the content changed since v${versionNumber}): ${[...result.unmatched, ...result.conflicts].join("; ")}`,
          at: now(),
        });
      }

      const content = await contentMap(demoDir);
      const withShots = await Promise.all(
        notes.map(async (n) => {
          const file = `note-${n.id}.png`;
          const exists = await stat(join(dir, file)).then(() => true, () => false);
          return { ...n, ...(exists ? { screenshotFile: file } : {}) };
        }),
      );
      await writeFile(
        join(dir, "feedback.md"),
        feedbackMarkdown({
          versionNumber,
          submittedBy: fb.round.submittedBy,
          submittedAt: fb.round.submittedAt,
          applied: accepted.filter((e) => result.applied.includes(e.key)),
          notes: withShots,
          content,
        }),
      );
      await new DemoRepo(demoDir).commitAll(`Client edits from the review of v${versionNumber}`);
      await this.deps.library().updateMeta(ref, (m) => {
        m.status = "draft";
        if (m.lastRound) m.lastRound.status = "imported";
      });
      await this.record(ref, { type: "feedback", version: versionNumber, edits: result.applied.length, notes: notes.length, at: now() });

      if (!input.generate) return this.finish(ref, signal, `Client edits from the review of v${versionNumber}`, { firstVersion: false });

      const next = ((await this.deps.library().readMeta(ref)).versions.at(-1)?.number ?? versionNumber) + 1;
      const roundRel = posix.join(".prototyper", "rounds", `v${versionNumber}`);
      const r = await this.claudeStep(ref, revisionPrompt(roundRel, next, input.extraInstructions), signal);
      if (!r.ok) return false;
      if (!(await this.finish(ref, signal, `Address client notes from the review of v${versionNumber}`, { firstVersion: false }))) return false;

      const changelog = await changelogFor(demoDir, next);
      await this.saveVersion(ref, firstBullet(changelog) || `Client feedback on v${versionNumber}`);

      const replies = await readReplies(join(dir, "replies.json"), new Set(notes.map((n) => n.id)));
      await client.markImported(fb.round.id, replies);
      return true;
    });
  }

  private async findRoundFeedback(ref: DemoRef, roundId: number): Promise<ServerFeedback> {
    const meta = await this.deps.library().readMeta(ref);
    const versions = (await this.client(meta.share!.targetId).rounds(meta.id)).find((r) => r.id === roundId)?.versionNumber;
    if (versions == null) throw new Error("Unknown review round.");
    const saved = await readFile(join(this.roundDir(ref, versions), "feedback.json"), "utf8").catch(() => undefined);
    if (!saved) throw new Error("Load the feedback before applying it.");
    return JSON.parse(saved) as ServerFeedback;
  }

  /**
   * Refresh the review status of every shared demo; notify when a client submits.
   * Errors for one server don't stop the others.
   */
  async pollShares(): Promise<void> {
    const library = this.deps.library();
    for (const client of await library.list().catch(() => [])) {
      for (const demo of client.demos) {
        if (!demo.share || demo.share.status === "revoked") continue;
        const ref = { client: client.slug, demo: demo.slug };
        let last: RoundSummary | undefined;
        try {
          last = (await this.client(demo.share.targetId).rounds(demo.id)).at(-1);
        } catch {
          continue;
        }
        if (!last) continue;
        const prev = demo.lastRound;
        const changed = !prev || prev.id !== last.id || prev.status !== last.status || prev.edits !== last.edits || prev.comments !== last.comments;
        if (!changed) continue;
        const justSubmitted = last.status === "submitted" && (prev?.id !== last.id || prev.status !== "submitted");
        await library.updateMeta(ref, (m) => {
          m.lastRound = last;
          if (justSubmitted) m.status = "feedback";
        });
        if (justSubmitted) {
          this.deps.notify?.(ref, `${client.name} — ${demo.name}`, `${last.submittedBy ?? "The client"} sent feedback on v${last.versionNumber}: ${last.edits} edits, ${last.comments} notes.`);
        }
        this.deps.changed(ref);
      }
    }
  }

  private client(targetId: string): ShareClient {
    if (!this.deps.shareClient) throw new Error("Sharing is not configured.");
    return this.deps.shareClient(targetId);
  }

  // --- internals -------------------------------------------------------------------------------

  /** Run one exclusive task per demo, with cancellation and a final `done` event. */
  private async task(ref: DemoRef, fn: (signal: AbortSignal) => Promise<boolean>): Promise<void> {
    const key = keyOf(ref);
    if (this.running.has(key)) throw new Error("Claude is already working on this demo.");
    const abort = new AbortController();
    this.running.set(key, { abort });
    this.deps.changed(ref);
    let ok = false;
    try {
      ok = await fn(abort.signal);
    } catch (e) {
      await this.record(ref, { type: "error", message: (e as Error).message, at: now() });
    } finally {
      this.running.delete(key);
      await this.record(ref, { type: "done", ok: ok && !abort.signal.aborted, at: now() });
      this.deps.changed(ref);
    }
  }

  /** Build, lint (asking Claude to fix errors), thumbnail and commit. */
  private async finish(ref: DemoRef, signal: AbortSignal, message: string, opts: { firstVersion: boolean }): Promise<boolean> {
    const dir = this.dir(ref);
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) return false;
      this.phase(ref, "lint", "Checking the content contract…");
      const lint = await this.refreshLint(ref);
      await this.record(ref, { type: "lint", ...lint, at: now() });
      if (lint.errors === 0 || attempt >= MAX_LINT_FIX_ATTEMPTS) break;
      this.phase(ref, "lint-fix", `Asking Claude to fix ${lint.errors} lint error(s)…`);
      const r = await this.claudeStep(ref, lintFixPrompt(lint.report), signal);
      if (!r.ok) break;
    }

    await this.rebuild(ref, { quiet: false });
    try {
      await mkdir(join(dir, ".prototyper"), { recursive: true });
      await this.deps.capture(this.deps.preview.mount(keyOf(ref), join(dir, "dist")), join(dir, ".prototyper", "thumb.png"));
    } catch {
      /* thumbnails are best effort */
    }

    this.phase(ref, "commit", "Saving changes…");
    await new DemoRepo(dir).commitAll(message);
    if (opts.firstVersion) await this.saveVersion(ref, "First version");
    return true;
  }

  private async claudeStep(ref: DemoRef, prompt: string, signal: AbortSignal, userText?: string) {
    if (userText) await this.record(ref, { type: "user", text: userText, at: now() });
    this.phase(ref, "claude", "Claude is working…");

    const settings = this.deps.settings();
    const bin = await findClaude(settings.claudePath);
    if (!bin) {
      const text = "Claude Code not found. Check Settings.";
      await this.record(ref, { type: "error", message: text, at: now() });
      return { ok: false, text };
    }

    const library = this.deps.library();
    const cwd = this.dir(ref);
    const run = async (sessionId: string, resume: boolean) =>
      runClaude(
        {
          bin,
          cwd,
          prompt,
          sessionId,
          resume,
          appendSystemPrompt: SYSTEM_PROMPT,
          addDirs: [library.brandDir(ref.client)],
          ...(settings.model ? { model: settings.model } : {}),
          signal,
        },
        (e) => {
          if (e.type === "text") void this.record(ref, { type: "assistant", text: e.text, at: now() });
          if (e.type === "tool") void this.record(ref, { type: "tool", name: e.name, detail: describeTool(e.name, e.input, cwd), at: now() });
        },
      );

    const meta = await library.readMeta(ref);
    let result;
    if (meta.claudeSessionId) {
      result = await run(meta.claudeSessionId, true);
      if (result.sessionMissing) result = undefined;
    }
    if (!result) {
      const sessionId = randomUUID();
      await library.updateMeta(ref, (m) => {
        m.claudeSessionId = sessionId;
        m.claudeSessionCostUsd = 0;
      });
      result = await run(sessionId, false);
    }

    // The CLI reports the session's cumulative cost; show what this run added.
    let runCost: number | undefined;
    if (result.costUsd !== undefined) {
      const total = result.costUsd;
      const before = (await library.readMeta(ref)).claudeSessionCostUsd ?? 0;
      runCost = Math.max(0, total - before);
      await library.updateMeta(ref, (m) => void (m.claudeSessionCostUsd = total));
    }
    await this.record(ref, {
      type: "result",
      ok: result.ok,
      text: result.text,
      ...(runCost !== undefined ? { costUsd: runCost } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      at: now(),
    });
    return result;
  }

  private async refreshLint(ref: DemoRef): Promise<LintSummary> {
    const r = await lintSite(join(this.dir(ref), "src"));
    const summary: LintSummary = {
      errors: r.issues.filter((i) => i.severity === "error").length,
      warnings: r.issues.filter((i) => i.severity === "warning").length,
      report: r.report,
    };
    this.lint.set(keyOf(ref), summary);
    return summary;
  }

  private async rebuild(ref: DemoRef, opts: { quiet: boolean }): Promise<void> {
    if (!opts.quiet) this.phase(ref, "build", "Building the preview…");
    try {
      await buildSite(this.dir(ref));
      if (opts.quiet) await this.refreshLint(ref);
      this.deps.preview.reload(keyOf(ref));
      this.deps.changed(ref);
    } catch (e) {
      await this.record(ref, { type: "error", message: `Build failed: ${(e as Error).message}`, at: now() });
    }
  }

  private phase(ref: DemoRef, phase: RunPhase, message: string): void {
    this.deps.emit(ref, { type: "phase", phase, message, at: now() });
  }

  /** Emit to the renderer and append to the demo's persistent log. */
  private async record(ref: DemoRef, event: RunEvent): Promise<void> {
    this.deps.emit(ref, event);
    const dir = join(this.dir(ref), ".prototyper");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "log.jsonl"), JSON.stringify(event) + "\n");
  }
}

function firstLine(s: string): string {
  const line = s.trim().split("\n")[0] ?? "";
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function firstBullet(markdown: string): string {
  const line = markdown.split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).find(Boolean) ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** Claude's replies to the notes, restricted to the notes it was given. */
async function readReplies(file: string, noteIds: Set<string>): Promise<Record<string, { status: "resolved" | "answered"; reply?: string }>> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, { status?: string; reply?: string }>;
    const out: Record<string, { status: "resolved" | "answered"; reply?: string }> = {};
    for (const [id, r] of Object.entries(raw)) {
      if (!noteIds.has(id)) continue;
      out[id] = { status: r.status === "answered" ? "answered" : "resolved", ...(typeof r.reply === "string" ? { reply: r.reply.slice(0, 5000) } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}
