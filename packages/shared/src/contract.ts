import { z } from "zod";

/**
 * The prototype contract.
 *
 * Every piece of client-editable content in a prototype carries a stable,
 * demo-wide key. Client edits are stored by key and spliced back into the
 * HTML deterministically, without involving the model.
 */

/** Marks an editable element. Value: the content key. */
export const PT_ATTR = "data-pt";
/** Optional explicit kind for a `data-pt` element (`text` | `rich` | `image` | `link`). */
export const PT_TYPE_ATTR = "data-pt-type";
/** Marks an element whose inline `background-image` is editable. Value: the content key. */
export const PT_BG_ATTR = "data-pt-bg";
/** Excludes an element and its subtree from the contract (decorative content). */
export const PT_IGNORE_ATTR = "data-pt-ignore";

export const PT_KINDS = ["text", "rich", "image", "link", "bg"] as const;
export type PtKind = (typeof PT_KINDS)[number];

/**
 * Keys are dot-separated, lowercase segments, at least two of them:
 * `home.hero.title`, `global.nav.contact`, `services.items-2.title`.
 */
export const KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Tags allowed inside `rich` content. Everything else is unwrapped or dropped. */
export const RICH_ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "br", "a"]);

export const TextValue = z.object({ kind: z.literal("text"), text: z.string().max(20_000) });
export const RichValue = z.object({ kind: z.literal("rich"), html: z.string().max(50_000) });
export const ImageValue = z.object({
  kind: z.literal("image"),
  src: z.string().min(1).max(2_000),
  alt: z.string().max(1_000).optional(),
});
export const LinkValue = z.object({
  kind: z.literal("link"),
  label: z.string().max(1_000),
  href: z.string().max(2_000),
});
export const BgValue = z.object({ kind: z.literal("bg"), src: z.string().min(1).max(2_000) });

export const ContentValue = z.discriminatedUnion("kind", [
  TextValue,
  RichValue,
  ImageValue,
  LinkValue,
  BgValue,
]);
export type ContentValue = z.infer<typeof ContentValue>;

export const ContentEdit = z.object({
  key: z.string().regex(KEY_PATTERN),
  value: ContentValue,
});
export type ContentEdit = z.infer<typeof ContentEdit>;
