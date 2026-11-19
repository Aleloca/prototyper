import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Files that make up a web page (or its assets) when dropped loose. */
export const SOURCE_EXT = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".txt", ".md",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "__MACOSX", ".svn", ".idea", ".vscode"]);
const MAX_FILES = 3000;
const MAX_BYTES = 300 * 1024 * 1024;

export interface ImportedSource {
  /** Folder with the imported files. */
  dir: string;
  /** Relative paths of the files, sorted. */
  files: string[];
}

/** Is this a page source (folder, zip, or HTML file) rather than a reference image? */
export async function isSourcePath(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => undefined);
  if (!s) return false;
  if (s.isDirectory()) return true;
  const ext = extname(path).toLowerCase();
  return ext === ".zip" || ext === ".html" || ext === ".htm";
}

/**
 * Copy page sources into a fresh folder under `destRoot`: folders are copied (without node_modules,
 * .git, symlinks…), zips are extracted, loose files are gathered together. Images that come along with
 * HTML/CSS are kept as part of the site.
 */
export async function importSource(paths: string[], destRoot: string): Promise<ImportedSource> {
  if (!paths.length) throw new Error("Nothing to import.");
  const label = basename(paths[0]!, extname(paths[0]!)).replace(/[^\w.-]+/g, "-").slice(0, 40) || "site";
  const dir = join(destRoot, `${Date.now()}-source-${label}`);
  await mkdir(dir, { recursive: true });
  try {
    const budget = { files: 0, bytes: 0 };
    for (const p of paths) {
      const s = await lstat(p);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) {
        // A single dropped folder becomes the root; several folders keep their names.
        const target = paths.length === 1 ? dir : join(dir, basename(p));
        await copyTree(p, target, budget);
      } else if (extname(p).toLowerCase() === ".zip") {
        const target = paths.length === 1 ? dir : join(dir, basename(p, ".zip"));
        await extractZip(p, target);
      } else if (SOURCE_EXT.has(extname(p).toLowerCase())) {
        charge(budget, s.size);
        await cp(p, join(dir, basename(p)));
      } else {
        throw new Error(`${basename(p)} is not a web file (HTML, CSS, JS, images, fonts) nor a folder or zip.`);
      }
    }
    await unwrapSingleFolder(dir);
    await sanitize(dir);
    const files = await listFiles(dir);
    if (files.length > MAX_FILES) throw new Error(`Too many files (${files.length}); the limit is ${MAX_FILES}.`);
    if (!files.some((f) => /\.html?$/i.test(f))) throw new Error("No HTML page found in what you attached.");
    return { dir, files };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

function charge(budget: { files: number; bytes: number }, size: number): void {
  budget.files += 1;
  budget.bytes += size;
  if (budget.files > MAX_FILES) throw new Error(`Too many files; the limit is ${MAX_FILES}. Attach only the page and its assets.`);
  if (budget.bytes > MAX_BYTES) throw new Error("The files are too large (over 300 MB). Attach only the page and its assets.");
}

async function copyTree(from: string, to: string, budget: { files: number; bytes: number }): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.isSymbolicLink() || e.name === ".DS_Store") continue;
    const src = join(from, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      await copyTree(src, join(to, e.name), budget);
    } else if (e.isFile()) {
      charge(budget, (await stat(src)).size);
      await cp(src, join(to, e.name));
    }
  }
}

async function extractZip(zip: string, to: string): Promise<void> {
  const s = await stat(zip);
  if (s.size > MAX_BYTES) throw new Error("The zip is too large (over 300 MB).");
  await mkdir(to, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", "--norsrc", "--noextattr", "--noacl", zip, to]).catch((e: Error) => {
    throw new Error(`Could not extract ${basename(zip)}: ${e.message}`);
  });
}

/** Zips and folders often wrap everything in one folder: use its content as the root. */
async function unwrapSingleFolder(dir: string): Promise<void> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.name !== "__MACOSX" && e.name !== ".DS_Store");
  if (entries.length !== 1 || !entries[0]!.isDirectory()) return;
  const inner = join(dir, entries[0]!.name);
  const tmp = `${dir}-unwrap`;
  await rename(inner, tmp);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  await unwrapSingleFolder(dir);
}

/** Drop symlinks, OS junk and dependency folders (zips may contain any of them). */
async function sanitize(dir: string): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink() || e.name === ".DS_Store" || e.name.startsWith("._") || (e.isDirectory() && (SKIP_DIRS.has(e.name) || e.name.startsWith(".")))) {
      await rm(p, { recursive: true, force: true });
    } else if (e.isDirectory()) {
      await sanitize(p);
    }
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}

/** One-line description for prompts: "12 files: index.html, about.html, css/style.css, …". */
export function describeSource(src: ImportedSource): string {
  const pages = src.files.filter((f) => /\.html?$/i.test(f));
  const others = src.files.filter((f) => !/\.html?$/i.test(f));
  const shown = [...pages.slice(0, 8), ...others.slice(0, 6)];
  return `${src.files.length} files: ${shown.join(", ")}${src.files.length > shown.length ? ", …" : ""}`;
}
