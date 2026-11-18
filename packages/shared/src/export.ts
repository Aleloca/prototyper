import { PT_ATTR, PT_BG_ATTR, PT_IGNORE_ATTR, PT_TYPE_ATTR, type ContentValue, type PtKind } from "./contract.js";
import type { Page } from "./apply-edits.js";
import { lintDemo } from "./lint.js";
import { parseDocument, ptKey, bgKey, textContent, walkElements, collapseWhitespace } from "./html.js";

const CONTRACT_ATTRS = new Set([PT_ATTR, PT_TYPE_ATTR, PT_BG_ATTR, PT_IGNORE_ATTR]);

/** Remove the prototype contract attributes (data-pt, data-pt-type, data-pt-bg, data-pt-ignore), leaving everything else untouched. */
export function stripContract(html: string): string {
  const ranges: [number, number][] = [];
  walkElements(parseDocument(html), (el) => {
    const attrs = el.sourceCodeLocation?.attrs;
    if (!attrs) return;
    for (const name of Object.keys(attrs)) {
      if (!CONTRACT_ATTRS.has(name)) continue;
      const loc = attrs[name]!;
      let start = loc.startOffset;
      while (start > 0 && /\s/.test(html[start - 1] ?? "")) start -= 1;
      ranges.push([start, loc.endOffset]);
    }
  });
  ranges.sort((a, b) => b[0] - a[0]);
  let out = html;
  for (const [start, end] of ranges) out = out.slice(0, start) + out.slice(end);
  return out;
}

export interface ContentInventory {
  pages: { path: string; title: string; keys: string[] }[];
  content: Record<string, { kind: PtKind; value: ContentValue; pages: string[] }>;
}

/** Every editable piece of content, by page in document order and by key — ready for a CMS import. */
export function contentInventory(pages: readonly Page[]): ContentInventory {
  const { content } = lintDemo({ pages });
  const inventory: ContentInventory = { pages: [], content: {} };
  for (const page of pages) {
    const doc = parseDocument(page.html);
    let title = "";
    const keys: string[] = [];
    walkElements(doc, (el) => {
      if (el.tagName === "title" && !title) title = collapseWhitespace(textContent(el));
      for (const k of [ptKey(el), bgKey(el)]) if (k && !keys.includes(k)) keys.push(k);
    });
    inventory.pages.push({ path: page.path, title, keys });
  }
  for (const [key, entry] of [...content.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    inventory.content[key] = { kind: entry.kind, value: entry.value, pages: [...new Set(entry.occurrences.map((o) => o.page))] };
  }
  return inventory;
}
