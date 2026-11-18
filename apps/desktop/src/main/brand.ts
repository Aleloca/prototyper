import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BRAND_TOKENS, SYSTEM_PROMPT, brandPrompt } from "@prototyper/prototype-kit";
import type { BrandInfo, BrandTokens, RunEvent, Settings } from "../common/types";
import { clusterColors, type BrandRaw } from "./brand-extract";
import { findClaude, describeTool, runClaude } from "./claude";
import type { Library } from "./library";

/** Result of rendering one page of the client's website (needs Electron). */
export interface PageCapture {
  raw: BrandRaw;
  desktop: Buffer;
  mobile?: Buffer;
}

export interface BrandServiceDeps {
  library: () => Library;
  settings: () => Settings;
  /** Load `url` in a hidden browser, run the extractor, take screenshots. */
  capturePage: (url: string, opts: { mobile: boolean }) => Promise<PageCapture>;
  /** Small data-URL thumbnail of an image file (needs Electron). */
  thumbnail: (file: string, width: number) => Promise<string | undefined>;
}

const now = () => new Date().toISOString();
const MAX_EXTRA_PAGES = 3;

/** Prefer pages that say most about the brand: about, services, contact. */
function pickPages(raw: BrandRaw): string[] {
  const score = (t: string) => (/chi siamo|about|studio|azienda|company|servizi|services|cosa facciamo|contatt|contact/i.test(t) ? 1 : 0);
  const home = new URL(raw.url);
  return raw.navLinks
    .filter((l) => {
      const u = new URL(l.href);
      return u.origin === home.origin && u.pathname !== home.pathname && !/\.(pdf|jpe?g|png|zip)$/i.test(u.pathname);
    })
    .sort((a, b) => score(b.text) - score(a.text))
    .slice(0, MAX_EXTRA_PAGES)
    .map((l) => l.href);
}

export class BrandService {
  constructor(private readonly deps: BrandServiceDeps) {}

  private dir(client: string): string {
    return this.deps.library().brandDir(client);
  }

  async info(client: string): Promise<BrandInfo> {
    const library = this.deps.library();
    const info = await library.getClient(client);
    const dir = this.dir(client);
    const read = (f: string) => readFile(join(dir, f), "utf8").catch(() => undefined);
    const tokensCss = await read("tokens.css");
    const brandMd = await read("BRAND.md");
    const raw = await read("brand.json").then((t) => (t ? (JSON.parse(t) as { extractedAt?: string; pages?: string[] }) : undefined));
    const files = await readdir(dir).catch(() => [] as string[]);
    const logoFile = files.find((f) => /^logo\.(svg|png|jpe?g|webp|gif|ico)$/i.test(f));
    const shots = (await readdir(join(dir, "screenshots")).catch(() => [] as string[])).filter((f) => f.endsWith(".jpg")).sort();
    return {
      client: info.slug,
      clientName: info.name,
      ...(info.website ? { website: info.website } : {}),
      hasBrand: tokensCss !== undefined,
      tokens: tokensCss ? parseTokens(tokensCss) : {},
      brandMd: brandMd ?? "",
      ...(raw?.extractedAt ? { extractedAt: raw.extractedAt } : {}),
      ...(raw?.pages ? { pages: raw.pages } : {}),
      ...(logoFile ? { logo: await this.deps.thumbnail(join(dir, logoFile), 320) } : {}),
      screenshots: (await Promise.all(shots.map((f) => this.deps.thumbnail(join(dir, "screenshots", f), 360)))).filter((s): s is string => !!s),
    };
  }

  async saveTokens(client: string, tokens: BrandTokens): Promise<void> {
    const file = join(this.dir(client), "tokens.css");
    const current = await readFile(file, "utf8").catch(() => "@theme {\n}\n");
    await writeFile(file, updateTokens(current, tokens));
  }

  async saveBrandMd(client: string, text: string): Promise<void> {
    await mkdir(this.dir(client), { recursive: true });
    await writeFile(join(this.dir(client), "BRAND.md"), text);
  }

  /**
   * Read the client's website, save raw data, screenshots and logo in the brand folder,
   * then let Claude write BRAND.md and tokens.css.
   */
  async extract(client: string, website: string, emit: (e: RunEvent) => void, signal?: AbortSignal): Promise<boolean> {
    const library = this.deps.library();
    const info = await library.getClient(client);
    const url = normalizeUrl(website);
    if (url !== info.website) await library.updateClient(client, { website: url });
    const dir = this.dir(client);
    await mkdir(join(dir, "screenshots"), { recursive: true });

    const phase = (message: string) => emit({ type: "phase", phase: "brand", message, at: now() });

    phase(`Reading ${url}…`);
    const home = await this.deps.capturePage(url, { mobile: true });
    const pages: BrandRaw[] = [home.raw];
    await rm(join(dir, "screenshots"), { recursive: true, force: true });
    await mkdir(join(dir, "screenshots"), { recursive: true });
    await writeFile(join(dir, "screenshots", "1-home-desktop.jpg"), home.desktop);
    if (home.mobile) await writeFile(join(dir, "screenshots", "1-home-mobile.jpg"), home.mobile);

    let n = 2;
    for (const pageUrl of pickPages(home.raw)) {
      if (signal?.aborted) return false;
      phase(`Reading ${new URL(pageUrl).pathname}…`);
      try {
        const page = await this.deps.capturePage(pageUrl, { mobile: false });
        pages.push(page.raw);
        await writeFile(join(dir, "screenshots", `${n++}-${slug(new URL(pageUrl).pathname)}-desktop.jpg`), page.desktop);
      } catch {
        /* skip pages that fail to load */
      }
    }

    phase("Saving the logo…");
    await this.saveLogo(dir, home.raw);

    const merged = mergePages(pages);
    await writeFile(join(dir, "brand.json"), JSON.stringify({ extractedAt: now(), pages: pages.map((p) => p.url), ...merged }, null, 2));
    emit({ type: "assistant", text: `Read ${pages.length} page(s) of ${url}: ${merged.colors.length} colors, ${merged.fonts.length} font styles, ${merged.buttons.length} buttons.`, at: now() });

    phase("Claude is writing the brand guidelines…");
    const settings = this.deps.settings();
    const bin = await findClaude(settings.claudePath);
    if (!bin) {
      emit({ type: "error", message: "Claude Code not found. Check Settings.", at: now() });
      return false;
    }
    const result = await runClaude(
      {
        bin,
        cwd: dir,
        prompt: brandPrompt(info.name, url),
        sessionId: randomUUID(),
        resume: false,
        appendSystemPrompt: SYSTEM_PROMPT.replace("Follow CLAUDE.md in the working directory exactly, especially the data-pt content contract.\n", ""),
        ...(settings.model ? { model: settings.model } : {}),
        ...(signal ? { signal } : {}),
      },
      (e) => {
        if (e.type === "text") emit({ type: "assistant", text: e.text, at: now() });
        if (e.type === "tool") emit({ type: "tool", name: e.name, detail: describeTool(e.name, e.input, dir), at: now() });
      },
    );
    emit({ type: "result", ok: result.ok, text: result.text, ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}), ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}), at: now() });
    const hasTokens = await stat(join(dir, "tokens.css")).then(() => true, () => false);
    return result.ok && hasTokens;
  }

  private async saveLogo(dir: string, raw: BrandRaw): Promise<void> {
    for (const f of await readdir(dir).catch(() => [] as string[])) if (/^logo\./.test(f)) await rm(join(dir, f), { force: true });
    if (raw.logo?.svg) {
      const svg = raw.logo.svg.includes("xmlns=") ? raw.logo.svg : raw.logo.svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      await writeFile(join(dir, "logo.svg"), svg);
      return;
    }
    for (const src of [raw.logo?.src, raw.favicon].filter((s): s is string => !!s)) {
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) continue;
        const type = res.headers.get("content-type") ?? "";
        const ext = /svg/.test(type) ? ".svg" : /png/.test(type) ? ".png" : /webp/.test(type) ? ".webp" : /jpe?g/.test(type) ? ".jpg" : /icon/.test(type) ? ".ico" : extname(new URL(src).pathname) || ".png";
        await writeFile(join(dir, `logo${ext}`), Buffer.from(await res.arrayBuffer()));
        return;
      } catch {
        /* try the next candidate */
      }
    }
  }
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The website must be an http(s) address.");
  return url.toString();
}

function slug(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "page";
}

/** Combine the data of several pages: colors summed and clustered, the rest de-duplicated. */
export function mergePages(pages: BrandRaw[]) {
  const home = pages[0]!;
  const uniq = <T>(items: T[], key: (t: T) => string) => Array.from(new Map(items.map((i) => [key(i), i])).values());
  return {
    title: home.title,
    description: home.description,
    lang: home.lang,
    colors: clusterColors(pages.flatMap((p) => p.colors).sort((a, b) => b.weight - a.weight)).slice(0, 16),
    fonts: uniq(pages.flatMap((p) => p.fonts), (f) => `${f.role}|${f.family}|${f.weight}|${f.size}`).slice(0, 12),
    fontFaces: uniq(pages.flatMap((p) => p.fontFaces), (f) => f),
    googleFonts: uniq(pages.flatMap((p) => p.googleFonts), (f) => f),
    buttons: uniq(pages.flatMap((p) => p.buttons), (b) => `${b.background}|${b.color}|${b.radius}`).slice(0, 8),
    radii: home.radii,
    shadows: home.shadows,
    logo: home.logo ? { ...home.logo, svg: home.logo.svg ? "(saved as logo.svg)" : undefined } : null,
    copy: {
      h1: uniq(pages.flatMap((p) => p.copy.h1), (t) => t).slice(0, 6),
      h2: uniq(pages.flatMap((p) => p.copy.h2), (t) => t).slice(0, 20),
      paragraphs: uniq(pages.flatMap((p) => p.copy.paragraphs), (t) => t).slice(0, 20),
      ctas: uniq(pages.flatMap((p) => p.copy.ctas), (t) => t).slice(0, 12),
    },
  };
}

/** Read `--name: value;` declarations from a tokens.css file. */
export function parseTokens(css: string): BrandTokens {
  const out: BrandTokens = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** Update token values in place, appending missing ones inside the @theme block. */
export function updateTokens(css: string, tokens: BrandTokens): string {
  let out = css;
  const missing: string[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    if (!/^--[\w-]+$/.test(name) || /[;{}]/.test(value)) continue;
    const re = new RegExp(`(${name.replace(/-/g, "\\-")}\\s*:\\s*)([^;]+)(;)`);
    if (re.test(out)) out = out.replace(re, (_m, a: string, _v: string, c: string) => `${a}${value.trim()}${c}`);
    else missing.push(`  ${name}: ${value.trim()};`);
  }
  if (missing.length) {
    const close = out.lastIndexOf("}");
    out = close === -1 ? `@theme {\n${missing.join("\n")}\n}\n` : `${out.slice(0, close)}${missing.join("\n")}\n${out.slice(close)}`;
  }
  return out;
}

export { BRAND_TOKENS };
