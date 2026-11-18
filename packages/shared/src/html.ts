import { parse, parseFragment, type DefaultTreeAdapterTypes as T } from "parse5";
import {
  PT_ATTR,
  PT_BG_ATTR,
  PT_TYPE_ATTR,
  RICH_ALLOWED_TAGS,
  type ContentValue,
  type PtKind,
} from "./contract.js";

export type Element = T.Element;
export type Node = T.Node;
export type ParentNode = T.ParentNode;

export function parseDocument(html: string): T.Document {
  return parse(html, { sourceCodeLocationInfo: true });
}

export function isElement(node: Node): node is Element {
  return "tagName" in node;
}

export function isText(node: Node): node is T.TextNode {
  return node.nodeName === "#text";
}

export function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export function hasAttr(el: Element, name: string): boolean {
  return el.attrs.some((a) => a.name === name);
}

export function childNodes(node: Node): Node[] {
  return "childNodes" in node ? (node.childNodes as Node[]) : [];
}

/** Depth-first walk over elements. Return `false` from `visit` to skip the subtree. */
export function walkElements(root: Node, visit: (el: Element) => boolean | void): void {
  for (const child of childNodes(root)) {
    if (!isElement(child)) continue;
    if (visit(child) === false) continue;
    walkElements(child, visit);
  }
}

export function textContent(node: Node): string {
  if (isText(node)) return node.value;
  return childNodes(node).map(textContent).join("");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Kind of a `data-pt` element: explicit `data-pt-type`, else inferred from the tag. */
export function inferKind(el: Element): Exclude<PtKind, "bg"> | "invalid" {
  const explicit = getAttr(el, PT_TYPE_ATTR);
  if (explicit !== undefined) {
    return explicit === "text" || explicit === "rich" || explicit === "image" || explicit === "link"
      ? explicit
      : "invalid";
  }
  if (el.tagName === "img") return "image";
  if (el.tagName === "a") return "link";
  return "text";
}

const BG_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/i;

export function extractBgUrl(style: string | undefined): string | undefined {
  if (!style) return undefined;
  return BG_URL.exec(style)?.[2];
}

export function replaceBgUrl(style: string | undefined, src: string): string {
  const url = cssUrl(src);
  if (style && BG_URL.test(style)) return style.replace(BG_URL, url);
  const base = style?.trim() ?? "";
  const sep = base === "" || base.endsWith(";") ? "" : ";";
  return `${base}${sep}${base === "" ? "" : " "}background-image: ${url}`;
}

function cssUrl(src: string): string {
  return `url("${src.replace(/["\\\n\r]/g, (c) => "\\" + c)}")`;
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isSafeHref(href: string): boolean {
  const scheme = /^\s*([a-z][a-z0-9+.-]*:)/i.exec(href)?.[1]?.toLowerCase();
  return scheme === undefined || SAFE_SCHEMES.has(scheme);
}

const DROP_WITH_CONTENT = new Set([
  "script", "style", "template", "iframe", "object", "embed", "noscript", "svg", "math", "head", "title",
]);

/** Reduce arbitrary HTML to the `rich` allowlist. Unknown tags are unwrapped; dangerous ones dropped. */
export function sanitizeRich(html: string): string {
  return renderRich(childNodes(parseFragment(html)));
}

function renderRich(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (isText(node)) {
      out += escapeText(node.value);
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName;
    if (DROP_WITH_CONTENT.has(tag)) continue;
    const inner = renderRich(childNodes(node));
    if (!RICH_ALLOWED_TAGS.has(tag)) {
      out += inner;
    } else if (tag === "br") {
      out += "<br>";
    } else if (tag === "a") {
      const href = getAttr(node, "href");
      out += href !== undefined && isSafeHref(href) ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
    } else {
      out += `<${tag}>${inner}</${tag}>`;
    }
  }
  return out;
}

/** Inner HTML of an element, re-rendered through the rich allowlist. */
export function richInner(el: Element): string {
  return renderRich(childNodes(el));
}

/** Current value of a `data-pt` element of the given kind. */
export function readValue(el: Element, kind: Exclude<PtKind, "bg">): ContentValue {
  switch (kind) {
    case "text":
      return { kind, text: collapseWhitespace(textContent(el)) };
    case "rich":
      return { kind, html: collapseWhitespace(richInner(el)) };
    case "image": {
      const alt = getAttr(el, "alt");
      return alt === undefined
        ? { kind, src: getAttr(el, "src") ?? "" }
        : { kind, src: getAttr(el, "src") ?? "", alt };
    }
    case "link":
      return { kind, label: collapseWhitespace(textContent(el)), href: getAttr(el, "href") ?? "" };
  }
}

export function readBgValue(el: Element): ContentValue {
  return { kind: "bg", src: extractBgUrl(getAttr(el, "style")) ?? "" };
}

export function ptKey(el: Element): string | undefined {
  return getAttr(el, PT_ATTR);
}

export function bgKey(el: Element): string | undefined {
  return getAttr(el, PT_BG_ATTR);
}

export function location(el: Element): { line: number; col: number } {
  const loc = el.sourceCodeLocation;
  return { line: loc?.startLine ?? 0, col: loc?.startCol ?? 0 };
}
