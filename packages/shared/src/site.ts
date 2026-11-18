import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Page } from "./apply-edits.js";

export interface SiteFiles {
  pages: Page[];
  /** Every non-HTML file, as root-relative POSIX paths. */
  assets: string[];
}

/** Read a static site folder: HTML pages with their content, everything else as asset paths. Dotfiles are skipped. */
export async function readSite(dir: string): Promise<SiteFiles> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const pages: Page[] = [];
  const assets: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".")) continue;
    const abs = join(e.parentPath, e.name);
    const rel = relative(dir, abs).split(sep).join("/");
    if (rel.split("/").some((p) => p.startsWith("."))) continue;
    if (rel.endsWith(".html")) pages.push({ path: rel, html: await readFile(abs, "utf8") });
    else assets.push(rel);
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  assets.sort();
  return { pages, assets };
}
