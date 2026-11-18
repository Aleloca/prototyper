import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ReferenceItem } from "../common/types";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

interface StoredReference {
  file: string;
  note: string;
  source?: string;
  addedAt: string;
}

/**
 * Reference images of a demo: `<demo>/references/<file>` plus `references.json` (notes),
 * mirrored into `references/notes.md`, which is what Claude reads.
 */
export class References {
  constructor(
    private readonly demoDir: string,
    private readonly thumbnail?: (file: string, width: number) => Promise<string | undefined>,
  ) {}

  private get dir(): string {
    return join(this.demoDir, "references");
  }

  private async load(): Promise<StoredReference[]> {
    try {
      return JSON.parse(await readFile(join(this.dir, "references.json"), "utf8")) as StoredReference[];
    } catch {
      return [];
    }
  }

  private async save(items: StoredReference[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const json = join(this.dir, "references.json");
    await writeFile(`${json}.tmp`, JSON.stringify(items, null, 2));
    await rename(`${json}.tmp`, json);
    const md = [
      "# References",
      "",
      "Images picked by the developer as inspiration for this demo. Look at each one with the Read tool and follow the note.",
      "",
      ...items.flatMap((r) => [`## ${r.file}`, "", ...(r.source ? [`Screenshot of ${r.source}`, ""] : []), r.note.trim() || "(no note: general inspiration)", ""]),
    ].join("\n");
    await writeFile(join(this.dir, "notes.md"), md);
  }

  async list(): Promise<ReferenceItem[]> {
    const items = await this.load();
    return Promise.all(
      items.map(async (r) => {
        const thumb = await this.thumbnail?.(join(this.dir, r.file), 360);
        return { ...r, ...(thumb ? { thumbnail: thumb } : {}) };
      }),
    );
  }

  /** Copy a local image into the references folder. */
  async addFile(path: string, note = ""): Promise<void> {
    const ext = extname(path).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new Error(`${basename(path)} is not an image (PNG, JPG, WebP or GIF).`);
    await this.addBuffer(await readFile(path), ext, basename(path, extname(path)), note);
  }

  async addBuffer(data: Buffer, ext: string, name: string, note = "", source?: string): Promise<void> {
    const items = await this.load();
    const file = this.uniqueName(items, `${safeName(name)}${ext}`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, file), data);
    items.push({ file, note, ...(source ? { source } : {}), addedAt: new Date().toISOString() });
    await this.save(items);
  }

  async addCopy(path: string, note = ""): Promise<void> {
    const items = await this.load();
    const file = this.uniqueName(items, `${safeName(basename(path, extname(path)))}${extname(path).toLowerCase()}`);
    await mkdir(this.dir, { recursive: true });
    await copyFile(path, join(this.dir, file));
    items.push({ file, note, addedAt: new Date().toISOString() });
    await this.save(items);
  }

  async setNote(file: string, note: string): Promise<void> {
    const items = await this.load();
    const item = items.find((r) => r.file === file);
    if (!item) throw new Error(`Unknown reference: ${file}`);
    item.note = note;
    await this.save(items);
  }

  async remove(file: string): Promise<void> {
    const items = await this.load();
    if (!items.some((r) => r.file === file)) return;
    await rm(join(this.dir, basename(file)), { force: true });
    await this.save(items.filter((r) => r.file !== file));
  }

  private uniqueName(items: StoredReference[], name: string): string {
    const taken = new Set(items.map((r) => r.file));
    if (!taken.has(name)) return name;
    const ext = extname(name);
    const base = name.slice(0, -ext.length);
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}${ext}`)) return `${base}-${i}${ext}`;
  }
}

function safeName(s: string): string {
  return s.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reference";
}
