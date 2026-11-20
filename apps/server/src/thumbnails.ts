import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { isIP } from "node:net";
import type { FastifyBaseLogger } from "fastify";
import sharp from "sharp";
import type { Browser } from "playwright-core";
import type { Store, VersionRow } from "./db.js";

const VIEWPORT = { width: 1280, height: 800 };
const THUMB_WIDTH = 640;
const SITE = "http://site.prototyper.invalid";
const IDLE_CLOSE_MS = 60_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Requests a published site may make while being photographed: its own files, and public https. */
function allowedExternal(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (isIP(host)) {
    // No private, loopback or link-local addresses: the server's own network stays out of reach.
    if (/^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.)/.test(host) || host === "::1" || /^f[cd]|^fe80/i.test(host)) return false;
  }
  return true;
}

/**
 * Screenshots of each version's home page, shown on the panel's project cards. A headless Chromium
 * (installed on the server by the deploy script) renders the version's files from disk; one at a time.
 */
export class Thumbnails {
  private browser: Promise<Browser> | undefined;
  private idle: NodeJS.Timeout | undefined;
  private readonly queue: number[] = [];
  private working = false;
  private disabled = false;

  constructor(
    private readonly store: Store,
    private readonly dir: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  path(versionId: number): string {
    return join(this.dir, `${versionId}.webp`);
  }

  async exists(versionId: number): Promise<boolean> {
    return stat(this.path(versionId)).then(() => true, () => false);
  }

  /** Queue a version; returns at once. */
  request(versionId: number): void {
    if (this.disabled || this.queue.includes(versionId)) return;
    this.queue.push(versionId);
    void this.drain();
  }

  /** Thumbnails missing for the latest version of every project (after an upgrade, or a failed run). */
  async backfill(): Promise<void> {
    const latest = this.store.all<{ id: number }>("SELECT MAX(id) AS id FROM versions GROUP BY project_id");
    for (const { id } of latest) if (!(await this.exists(id))) this.request(id);
  }

  async close(): Promise<void> {
    clearTimeout(this.idle);
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b.catch(() => undefined))?.close().catch(() => {});
  }

  private async drain(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const version = this.store.version(id);
        if (!version) continue;
        try {
          await this.render(version);
        } catch (e) {
          this.log.warn({ version: id, err: (e as Error).message }, "thumbnail failed");
          if (/Executable doesn't exist|browserType.launch/i.test((e as Error).message)) {
            this.disabled = true;
            this.queue.length = 0;
            this.log.warn("thumbnails disabled: Chromium is not installed (run the deploy script, or `npx playwright-core install chromium`)");
          }
        }
      }
    } finally {
      this.working = false;
      clearTimeout(this.idle);
      this.idle = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
      this.idle.unref();
    }
  }

  private async launch(): Promise<Browser> {
    if (!this.browser) {
      const { chromium } = await import("playwright-core");
      this.browser = chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
      this.browser.catch(() => (this.browser = undefined));
    }
    return this.browser;
  }

  private async render(version: VersionRow): Promise<void> {
    const browser = await this.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block" });
    try {
      const root = version.dir;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === SITE) {
          let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
          if (rel === "" || rel.endsWith("/")) rel += "index.html";
          const file = normalize(join(root, rel));
          if (!file.startsWith(root + sep)) return route.fulfill({ status: 404, body: "" });
          const body = await readFile(file).catch(() => undefined);
          if (!body) return route.fulfill({ status: 404, body: "" });
          return route.fulfill({ status: 200, body, contentType: TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
        }
        return allowedExternal(url) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.goto(`${SITE}/index.html`, { waitUntil: "load", timeout: 20_000 }).catch(() => {});
      // Fonts and late images; never wait long for a site that keeps loading.
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
      await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, ...VIEWPORT } });
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path(version.id)}.tmp`;
      await sharp(png).resize({ width: THUMB_WIDTH }).webp({ quality: 80 }).toFile(tmp);
      await rename(tmp, this.path(version.id));
    } finally {
      await context.close().catch(() => {});
    }
  }
}
