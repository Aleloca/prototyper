import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { scaffoldDemo } from "@prototyper/prototype-kit";
import type {
  ClientInfo,
  DemoMeta,
  DemoRef,
  DemoSummary,
  LibraryClient,
  NewClientInput,
  NewDemoInput,
} from "../common/types";

/**
 * The library is plain files:
 *   <root>/clients/<client>/client.json
 *   <root>/clients/<client>/brand/
 *   <root>/clients/<client>/demos/<demo>/prototyper.json
 */
export class Library {
  constructor(readonly root: string) {}

  clientDir(client: string): string {
    return join(this.root, "clients", safeSegment(client));
  }

  brandDir(client: string): string {
    return join(this.clientDir(client), "brand");
  }

  demoDir(ref: DemoRef): string {
    return join(this.clientDir(ref.client), "demos", safeSegment(ref.demo));
  }

  async list(): Promise<LibraryClient[]> {
    const clientsDir = join(this.root, "clients");
    const slugs = await listDirs(clientsDir);
    const clients: LibraryClient[] = [];
    for (const slug of slugs) {
      const info = await readJson<ClientInfo>(join(clientsDir, slug, "client.json"));
      if (!info) continue;
      const demos: DemoSummary[] = [];
      for (const demoSlug of await listDirs(join(clientsDir, slug, "demos"))) {
        const meta = await this.readMeta({ client: slug, demo: demoSlug }).catch(() => undefined);
        if (!meta) continue;
        const thumbnail = await readFile(join(this.demoDir({ client: slug, demo: demoSlug }), ".prototyper", "thumb.png"))
          .then((b) => `data:image/png;base64,${b.toString("base64")}`)
          .catch(() => undefined);
        demos.push(thumbnail ? { ...meta, thumbnail } : meta);
      }
      demos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const hasBrand = await readFile(join(clientsDir, slug, "brand", "tokens.css")).then(() => true, () => false);
      clients.push({ ...info, demos, hasBrand });
    }
    clients.sort((a, b) => a.name.localeCompare(b.name));
    return clients;
  }

  async createClient(input: NewClientInput): Promise<ClientInfo> {
    const name = input.name.trim();
    if (!name) throw new Error("Client name is required");
    const slug = await uniqueSlug(join(this.root, "clients"), slugify(name));
    const info: ClientInfo = {
      slug,
      name,
      ...(input.website?.trim() ? { website: input.website.trim() } : {}),
      createdAt: new Date().toISOString(),
    };
    await mkdir(join(this.clientDir(slug), "brand"), { recursive: true });
    await mkdir(join(this.clientDir(slug), "demos"), { recursive: true });
    await writeJson(join(this.clientDir(slug), "client.json"), info);
    return info;
  }

  async getClient(slug: string): Promise<ClientInfo> {
    const info = await readJson<ClientInfo>(join(this.clientDir(slug), "client.json"));
    if (!info) throw new Error(`Unknown client: ${slug}`);
    return info;
  }

  async updateClient(slug: string, patch: Partial<Pick<ClientInfo, "name" | "website">>): Promise<ClientInfo> {
    const info = { ...(await this.getClient(slug)), ...patch };
    await writeJson(join(this.clientDir(slug), "client.json"), info);
    return info;
  }

  async createDemo(input: NewDemoInput): Promise<DemoMeta> {
    const client = await this.getClient(input.client);
    const name = input.name.trim();
    if (!name) throw new Error("Demo name is required");
    const demosDir = join(this.clientDir(client.slug), "demos");
    await mkdir(demosDir, { recursive: true });
    const slug = await uniqueSlug(demosDir, slugify(name));
    const ref = { client: client.slug, demo: slug };
    const dir = this.demoDir(ref);

    const pages = input.pages.map((p) => p.trim()).filter(Boolean);
    await scaffoldDemo(dir, {
      demoName: name,
      clientName: client.name,
      language: input.language.trim() || "English",
      brandDir: relative(dir, this.brandDir(client.slug)),
      brief: input.brief.trim() || "(No brief yet.)",
      pages: pages.length ? pages : ["Home"],
    });

    const now = new Date().toISOString();
    const meta: DemoMeta = {
      id: randomUUID(),
      slug,
      clientSlug: client.slug,
      name,
      language: input.language.trim() || "English",
      pages: pages.length ? pages : ["Home"],
      status: "draft",
      createdAt: now,
      updatedAt: now,
      versions: [],
    };
    await this.writeMeta(meta);
    return meta;
  }

  async readMeta(ref: DemoRef): Promise<DemoMeta> {
    const meta = await readJson<DemoMeta>(join(this.demoDir(ref), "prototyper.json"));
    if (!meta) throw new Error(`Unknown demo: ${ref.client}/${ref.demo}`);
    return meta;
  }

  async writeMeta(meta: DemoMeta): Promise<void> {
    await writeJson(join(this.demoDir({ client: meta.clientSlug, demo: meta.slug }), "prototyper.json"), meta);
  }

  async updateMeta(ref: DemoRef, patch: (m: DemoMeta) => DemoMeta | void): Promise<DemoMeta> {
    const meta = await this.readMeta(ref);
    const next = patch(meta) ?? meta;
    next.updatedAt = new Date().toISOString();
    await this.writeMeta(next);
    return next;
  }
}

export function slugify(s: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

/** Guard against path traversal from renderer-supplied refs. */
function safeSegment(s: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error(`Invalid name: ${s}`);
  return s;
}

async function uniqueSlug(parent: string, base: string): Promise<string> {
  const taken = new Set(await listDirs(parent));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Write atomically so a crash never leaves a truncated JSON file. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, path);
}
