import type { ContentEdit, ContentValue } from "./contract.js";
import {
  bgKey,
  escapeAttr,
  escapeText,
  getAttr,
  inferKind,
  parseDocument,
  ptKey,
  replaceBgUrl,
  sanitizeRich,
  walkElements,
  type Element,
} from "./html.js";

export interface EditConflict {
  key: string;
  page?: string;
  reason: "kind-mismatch" | "no-end-tag" | "nested" | "invalid-kind";
  message: string;
}

export interface ApplyResult {
  html: string;
  /** Keys that matched at least one element and were written. */
  applied: Set<string>;
  conflicts: EditConflict[];
}

interface Splice {
  start: number;
  end: number;
  text: string;
  key: string;
}

/**
 * Apply content edits to one HTML document by splicing the original source.
 * Everything outside the edited ranges stays byte-for-byte identical.
 */
export function applyEdits(html: string, edits: readonly ContentEdit[]): ApplyResult {
  const byKey = new Map<string, ContentValue>();
  for (const e of edits) byKey.set(e.key, e.value);

  const splices: Splice[] = [];
  const conflicts: EditConflict[] = [];
  const applied = new Set<string>();

  walkElements(parseDocument(html), (el) => {
    const key = ptKey(el);
    if (key !== undefined) {
      const value = byKey.get(key);
      if (value) {
        const result = planPtEdit(html, el, key, value);
        if ("reason" in result) conflicts.push(result);
        else splices.push(...result);
      }
    }
    const bg = bgKey(el);
    if (bg !== undefined) {
      const value = byKey.get(bg);
      if (value) {
        if (value.kind !== "bg") {
          conflicts.push({ key: bg, reason: "kind-mismatch", message: `"${bg}" is a background, got a ${value.kind} edit` });
        } else {
          splices.push(setAttr(html, el, "style", replaceBgUrl(getAttr(el, "style"), value.src), bg));
        }
      }
    }
  });

  // Apply back to front; drop splices that overlap one already applied (nested keys).
  splices.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  let floor = Infinity;
  for (const s of splices) {
    if (s.end > floor) {
      conflicts.push({ key: s.key, reason: "nested", message: `"${s.key}" is nested inside another edited key` });
      continue;
    }
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    applied.add(s.key);
    floor = Math.min(floor, s.start);
  }
  return { html: out, applied, conflicts };
}

function planPtEdit(html: string, el: Element, key: string, value: ContentValue): Splice[] | EditConflict {
  const kind = inferKind(el);
  if (kind === "invalid") return { key, reason: "invalid-kind", message: `"${key}" has an invalid data-pt-type` };
  if (kind !== value.kind) {
    return { key, reason: "kind-mismatch", message: `"${key}" is ${kind}, got a ${value.kind} edit` };
  }

  switch (value.kind) {
    case "text":
    case "rich": {
      const inner = innerRange(el);
      if (!inner) return noEndTag(key);
      const text = value.kind === "text" ? escapeText(value.text) : sanitizeRich(value.html);
      return [{ ...inner, text, key }];
    }
    case "link": {
      const inner = innerRange(el);
      if (!inner) return noEndTag(key);
      return [{ ...inner, text: escapeText(value.label), key }, setAttr(html, el, "href", value.href, key)];
    }
    case "image": {
      const out = [setAttr(html, el, "src", value.src, key)];
      if (value.alt !== undefined) out.push(setAttr(html, el, "alt", value.alt, key));
      // A stale srcset would override the new src in the browser.
      for (const attr of ["srcset", "sizes"]) {
        const rm = removeAttr(html, el, attr, key);
        if (rm) out.push(rm);
      }
      return out;
    }
    default:
      // Unreachable: `kind` is never "bg", so a bg edit fails the mismatch check above.
      return { key, reason: "kind-mismatch", message: `"${key}" is ${kind}, got a bg edit` };
  }
}

function noEndTag(key: string): EditConflict {
  return { key, reason: "no-end-tag", message: `"${key}" has no explicit closing tag` };
}

function innerRange(el: Element): { start: number; end: number } | undefined {
  const loc = el.sourceCodeLocation;
  if (!loc?.startTag || !loc.endTag) return undefined;
  return { start: loc.startTag.endOffset, end: loc.endTag.startOffset };
}

function setAttr(html: string, el: Element, name: string, value: string, key: string): Splice {
  const text = `${name}="${escapeAttr(value)}"`;
  const attrLoc = el.sourceCodeLocation?.attrs?.[name];
  if (attrLoc) return { start: attrLoc.startOffset, end: attrLoc.endOffset, text, key };

  const startTag = el.sourceCodeLocation?.startTag;
  if (!startTag) throw new Error(`Missing source location for "${key}"`);
  let pos = startTag.endOffset - 1; // at ">"
  if (html[pos - 1] === "/") pos -= 1; // before "/>"
  while (pos > startTag.startOffset && /\s/.test(html[pos - 1] ?? "")) pos -= 1;
  return { start: pos, end: pos, text: ` ${text}`, key };
}

function removeAttr(html: string, el: Element, name: string, key: string): Splice | undefined {
  const attrLoc = el.sourceCodeLocation?.attrs?.[name];
  if (!attrLoc) return undefined;
  let start = attrLoc.startOffset;
  while (start > 0 && /\s/.test(html[start - 1] ?? "")) start -= 1;
  return { start, end: attrLoc.endOffset, text: "", key };
}

export interface Page {
  /** Path relative to the site root, POSIX separators: `index.html`, `services/web.html`. */
  path: string;
  html: string;
}

export interface DemoApplyResult {
  /** Only the pages whose HTML changed. */
  changed: Page[];
  applied: Set<string>;
  /** Edited keys that matched no element in any page. */
  unmatched: string[];
  conflicts: EditConflict[];
}

/** Apply edits across all pages of a demo. Keys are demo-wide. */
export function applyEditsToDemo(pages: readonly Page[], edits: readonly ContentEdit[]): DemoApplyResult {
  const changed: Page[] = [];
  const applied = new Set<string>();
  const conflicts: EditConflict[] = [];
  for (const page of pages) {
    const r = applyEdits(page.html, edits);
    r.applied.forEach((k) => applied.add(k));
    conflicts.push(...r.conflicts.map((c) => ({ ...c, page: page.path })));
    if (r.html !== page.html) changed.push({ path: page.path, html: r.html });
  }
  const unmatched = [...new Set(edits.map((e) => e.key))].filter((k) => !applied.has(k));
  return { changed, applied, unmatched, conflicts };
}
