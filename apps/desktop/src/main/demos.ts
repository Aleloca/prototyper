import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SYSTEM_PROMPT,
  buildFromStructurePrompt,
  generatePrompt,
  lintFixPrompt,
} from "@prototyper/prototype-kit";
import type { DemoDetail, DemoMeta, DemoRef, LintSummary, NewDemoInput, RunEvent, RunPhase, Settings } from "../common/types";
import { buildSite, lintSite } from "./build";
import { describeTool, findClaude, runClaude } from "./claude";
import { DemoRepo } from "./git";
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
    const meta = await this.deps.library().createDemo(input);
    const repo = new DemoRepo(this.dir({ client: meta.clientSlug, demo: meta.slug }));
    await repo.init();
    await repo.commitAll("Create demo");
    return meta;
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
    const exists = async (p: string) => stat(p).then(() => true, () => false);
    if ((await exists(thumb)) || !(await exists(join(dir, "dist", "index.html")))) return;
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
  generate(ref: DemoRef, opts: { structureFirst: boolean }): Promise<void> {
    return this.task(ref, async (signal) => {
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
