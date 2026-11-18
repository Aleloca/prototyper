import { posix } from "node:path";
import { PT_IGNORE_ATTR, RICH_ALLOWED_TAGS, isValidKey, type ContentValue, type PtKind } from "./contract.js";
import type { Page } from "./apply-edits.js";
import {
  bgKey,
  childNodes,
  extractBgUrl,
  getAttr,
  hasAttr,
  inferKind,
  isElement,
  isText,
  location,
  parseDocument,
  ptKey,
  readBgValue,
  readValue,
  walkElements,
  type Element,
} from "./html.js";

export type LintSeverity = "error" | "warning";

export type LintRule =
  | "invalid-key"
  | "invalid-type"
  | "key-conflict"
  | "missing-key"
  | "image-missing-key"
  | "image-not-img"
  | "text-has-markup"
  | "link-has-markup"
  | "rich-disallowed-tag"
  | "nested-key"
  | "no-end-tag"
  | "bg-missing-url"
  | "broken-link"
  | "missing-asset"
  | "missing-alt";

export interface LintIssue {
  rule: LintRule;
  severity: LintSeverity;
  page: string;
  line: number;
  col: number;
  key?: string;
  message: string;
}

export interface LintInput {
  pages: readonly Page[];
  /**
   * Every non-HTML file in the site, as root-relative POSIX paths.
   * When given, local `src`/`href`/background URLs are checked against it.
   */
  assets?: readonly string[];
}

export interface ContentEntry {
  key: string;
  kind: PtKind;
  value: ContentValue;
  occurrences: { page: string; line: number }[];
}

export interface LintResult {
  issues: LintIssue[];
  /** Every key found, with its (first) value. */
  content: Map<string, ContentEntry>;
  ok: boolean;
}

/** Elements whose text is never client-visible copy. */
const SKIP_SUBTREE = new Set(["head", "script", "style", "noscript", "template", "svg", "math", "iframe"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const HAS_LETTER = /\p{L}/u;

export function lintDemo(input: LintInput): LintResult {
  const issues: LintIssue[] = [];
  const content = new Map<string, ContentEntry>();
  const files = new Set([...input.pages.map((p) => p.path), ...(input.assets ?? [])]);

  for (const page of input.pages) {
    const report = (el: Element, rule: LintRule, severity: LintSeverity, message: string, key?: string) => {
      issues.push({ rule, severity, page: page.path, ...location(el), ...(key ? { key } : {}), message });
    };

    const record = (el: Element, key: string, kind: PtKind, value: ContentValue) => {
      const { line } = location(el);
      const existing = content.get(key);
      if (!existing) {
        content.set(key, { key, kind, value, occurrences: [{ page: page.path, line }] });
        return;
      }
      existing.occurrences.push({ page: page.path, line });
      if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
        const first = existing.occurrences[0]!;
        report(
          el,
          "key-conflict",
          "error",
          `Key "${key}" is reused with different content (first used at ${first.page}:${first.line}). ` +
            `The same key must always hold the same content; use a different key.`,
          key,
        );
      }
    };

    const checkUrl = (el: Element, url: string | undefined, rule: "broken-link" | "missing-asset") => {
      const target = resolveLocal(page.path, url);
      if (target === undefined) return;
      const isHtml = target.endsWith(".html");
      if (!isHtml && input.assets === undefined) return;
      if (!files.has(target)) {
        report(el, rule, "error", `"${url}" points to ${target}, which does not exist.`);
      }
    };

    const visit = (parent: Element | undefined, nodes: ReturnType<typeof childNodes>, insideKey: string | undefined) => {
      let reportedOrphanText = false;
      for (const node of nodes) {
        if (isText(node)) {
          if (!insideKey && parent && !reportedOrphanText && HAS_LETTER.test(node.value)) {
            reportedOrphanText = true;
            report(
              parent,
              "missing-key",
              "error",
              `Visible text "${truncate(node.value)}" is not inside a data-pt element. ` +
                `Wrap it in an element with a data-pt key, or mark decorative content with data-pt-ignore.`,
            );
          }
          continue;
        }
        if (!isElement(node)) continue;
        const el = node;
        if (SKIP_SUBTREE.has(el.tagName) || hasAttr(el, PT_IGNORE_ATTR)) continue;

        if (el.tagName === "a") checkUrl(el, getAttr(el, "href"), "broken-link");
        if (el.tagName === "img" || el.tagName === "source") checkUrl(el, getAttr(el, "src"), "missing-asset");

        const bg = bgKey(el);
        if (bg !== undefined) {
          const url = extractBgUrl(getAttr(el, "style"));
          if (!isValidKey(bg)) report(el, "invalid-key", "error", invalidKeyMessage(bg), bg);
          if (url === undefined) {
            report(el, "bg-missing-url", "error", `data-pt-bg="${bg}" needs an inline style with background-image: url(...).`, bg);
          } else {
            checkUrl(el, url, "missing-asset");
            record(el, bg, "bg", readBgValue(el));
          }
        }

        const key = ptKey(el);
        if (key === undefined) {
          if (el.tagName === "img") {
            report(el, "image-missing-key", "error", `<img src="${getAttr(el, "src") ?? ""}"> has no data-pt key.`);
          }
          visit(el, childNodes(el), insideKey);
          continue;
        }

        if (insideKey) {
          report(el, "nested-key", "error", `"${key}" is nested inside "${insideKey}". Editable elements must not contain other editable elements.`, key);
        }
        if (!isValidKey(key)) report(el, "invalid-key", "error", invalidKeyMessage(key), key);

        const kind = inferKind(el);
        if (kind === "invalid") {
          report(el, "invalid-type", "error", `data-pt-type="${getAttr(el, "data-pt-type")}" is not one of text, rich, image, link.`, key);
          continue;
        }
        if (kind === "image" && el.tagName !== "img") {
          report(el, "image-not-img", "error", `"${key}" is an image key but is on <${el.tagName}>. Use <img>, or data-pt-bg for backgrounds.`, key);
          continue;
        }
        if (kind !== "image" && !VOID.has(el.tagName) && !el.sourceCodeLocation?.endTag) {
          report(el, "no-end-tag", "error", `<${el.tagName} data-pt="${key}"> needs an explicit closing tag.`, key);
        }
        if (kind !== "image" && VOID.has(el.tagName)) {
          report(el, "invalid-type", "error", `"${key}" is on a void element <${el.tagName}>, which has no content to edit.`, key);
          continue;
        }

        const childEls = childNodes(el).filter(isElement);
        if (kind === "text" && childEls.length > 0) {
          report(el, "text-has-markup", "error", `"${key}" is plain text but contains <${childEls[0]!.tagName}>. Use data-pt-type="rich" for inline formatting, or put the key on a child element.`, key);
        }
        if (kind === "link" && childEls.length > 0) {
          report(el, "link-has-markup", "error", `Link "${key}" contains <${childEls[0]!.tagName}>. Put the data-pt key on a <span> holding only the label.`, key);
        }
        if (kind === "rich") {
          const bad = findDisallowed(el);
          if (bad) report(el, "rich-disallowed-tag", "warning", `Rich text "${key}" contains <${bad}>, which will be stripped when the client edits it. Allowed: ${[...RICH_ALLOWED_TAGS].join(", ")}.`, key);
        }
        if (kind === "image") {
          if (!hasAttr(el, "alt")) report(el, "missing-alt", "warning", `Image "${key}" has no alt text.`, key);
        }
        record(el, key, kind, readValue(el, kind));
        visit(el, childNodes(el), key);
      }
    };

    visit(undefined, childNodes(parseDocument(page.html)), undefined);
  }

  return { issues, content, ok: !issues.some((i) => i.severity === "error") };
}

function findDisallowed(el: Element): string | undefined {
  let found: string | undefined;
  walkElements(el, (child) => {
    if (found) return false;
    if (!RICH_ALLOWED_TAGS.has(child.tagName)) found = child.tagName;
  });
  return found;
}

function invalidKeyMessage(key: string): string {
  return `Key "${key}" is invalid. Use dot-separated lowercase segments, at least two: "home.hero.title".`;
}

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Resolve a URL used in `fromPage` to a root-relative file path, or undefined if it is not local. */
export function resolveLocal(fromPage: string, url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const u = url.trim();
  if (u === "" || u.startsWith("#") || u.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(u)) return undefined;
  let path = u.split(/[?#]/)[0]!;
  if (path === "") return undefined;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep as is */
  }
  const resolved = path.startsWith("/")
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromPage), path));
  return resolved.endsWith("/") || resolved === "." ? posix.join(resolved, "index.html") : resolved;
}

/** Human/model-readable report, used to feed lint errors back to Claude. */
export function formatIssues(issues: readonly LintIssue[]): string {
  return issues
    .map((i) => `${i.page}:${i.line}:${i.col} ${i.severity} [${i.rule}] ${i.message}`)
    .join("\n");
}
