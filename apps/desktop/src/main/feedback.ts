import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { applyEdits, lintDemo, readSite, type ContentEdit, type ContentEntry } from "@prototyper/shared";
import type { ContentValue, FeedbackEdit, FeedbackNote } from "../common/types";

/** Server URL of a client upload: /s/<token>/__pt/uploads/<uuid>. */
const UPLOAD_SRC = /^\/s\/[\w-]+\/__pt\/uploads\/([0-9a-f-]{36})$/;

export function uploadIdOf(src: string): string | undefined {
  return UPLOAD_SRC.exec(src)?.[1];
}

/** Where an accepted client upload lives inside the demo, relative to `src/`. */
export function clientAssetPath(uploadId: string): string {
  return `assets/client/${uploadId}.webp`;
}

/** Rewrite upload URLs to a path relative to `page`, so the edit works from any folder depth. */
export function localizeEdit(edit: ContentEdit, page: string): ContentEdit {
  const v = edit.value;
  if (v.kind !== "image" && v.kind !== "bg") return edit;
  const id = uploadIdOf(v.src);
  if (!id) return edit;
  const src = posix.relative(posix.dirname(page), clientAssetPath(id)) || clientAssetPath(id);
  return { key: edit.key, value: { ...v, src } };
}

export interface ApplyClientEditsResult {
  changedPages: string[];
  applied: string[];
  unmatched: string[];
  conflicts: string[];
}

/**
 * Apply accepted client edits to `<demo>/src`: copy uploaded images into src/assets/client/,
 * then splice every page by key. Pages are only rewritten when they change.
 */
export async function applyClientEdits(demoDir: string, edits: ContentEdit[], uploadsDir: string): Promise<ApplyClientEditsResult> {
  const srcDir = join(demoDir, "src");
  for (const e of edits) {
    if (e.value.kind !== "image" && e.value.kind !== "bg") continue;
    const id = uploadIdOf(e.value.src);
    if (!id) continue;
    await mkdir(join(srcDir, "assets", "client"), { recursive: true });
    await copyFile(join(uploadsDir, `${id}.webp`), join(srcDir, clientAssetPath(id)));
  }

  const site = await readSite(srcDir);
  const applied = new Set<string>();
  const conflicts: string[] = [];
  const changedPages: string[] = [];
  for (const page of site.pages) {
    const r = applyEdits(page.html, edits.map((e) => localizeEdit(e, page.path)));
    r.applied.forEach((k) => applied.add(k));
    conflicts.push(...r.conflicts.map((c) => `${page.path}: ${c.message}`));
    if (r.html !== page.html) {
      await writeFile(join(srcDir, page.path), r.html);
      changedPages.push(page.path);
    }
  }
  return { changedPages, applied: [...applied], unmatched: edits.map((e) => e.key).filter((k) => !applied.has(k)), conflicts };
}

/** Current content of the demo, by key, to describe what a note points at. */
export async function contentMap(demoDir: string): Promise<Map<string, ContentEntry>> {
  return lintDemo(await readSite(join(demoDir, "src"))).content;
}

export function describeValue(v: ContentValue | null | undefined, max = 140): string {
  if (!v) return "—";
  const clip = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  switch (v.kind) {
    case "text":
      return `"${clip(v.text)}"`;
    case "rich":
      return `"${clip(v.html.replace(/<[^>]+>/g, ""))}"`;
    case "link":
      return `link "${clip(v.label)}" → ${v.href}`;
    case "image":
      return `image ${v.src}${v.alt ? ` (alt "${clip(v.alt)}")` : ""}`;
    case "bg":
      return `background image ${v.src}`;
  }
}

export function describeAnchor(note: Pick<FeedbackNote, "anchor">, content: Map<string, ContentEntry>): string {
  const a = note.anchor;
  const where = `${Math.round(a.x * 100)}% from the left, ${Math.round(a.y * 100)}% from the top`;
  if (a.key) return `\`${a.key}\` — ${describeValue(content.get(a.key)?.value)} (${where} of it)`;
  if (a.selector) return `element \`${a.selector}\` (${where} of it)`;
  return "the page";
}

/** The file Claude reads to produce the next version. */
export function feedbackMarkdown(opts: {
  versionNumber: number;
  submittedBy: string | null;
  submittedAt: string | null;
  applied: FeedbackEdit[];
  notes: (FeedbackNote & { screenshotFile?: string })[];
  content: Map<string, ContentEntry>;
}): string {
  const lines = [`# Client feedback on v${opts.versionNumber}`, ""];
  if (opts.submittedBy) lines.push(`Sent by ${opts.submittedBy}${opts.submittedAt ? ` on ${opts.submittedAt.slice(0, 10)}` : ""}.`, "");

  lines.push("## Edits already applied to src/ (approved, keep them)", "");
  if (!opts.applied.length) lines.push("None.");
  for (const e of opts.applied) lines.push(`- \`${e.key}\` (${e.page}): ${describeValue(e.before)} → ${describeValue(e.value)}`);
  lines.push("");

  lines.push("## Notes to address", "");
  if (!opts.notes.length) lines.push("None. Only update CHANGELOG.md and write an empty replies.json (`{}`).");
  opts.notes.forEach((n, i) => {
    lines.push(`### Note ${i + 1} — id \`${n.id}\``, "");
    lines.push(`- From: ${n.author}`);
    lines.push(`- Page: ${n.page}`);
    lines.push(`- Points at: ${describeAnchor(n, opts.content)}`);
    if (n.screenshotFile) lines.push(`- Screenshot of the area: ${n.screenshotFile} (the note's position is marked)`);
    lines.push("", ...n.text.split("\n").map((l) => `> ${l}`), "");
  });
  return lines.join("\n");
}
