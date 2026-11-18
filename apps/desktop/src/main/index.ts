import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BrowserWindow, Notification, app, dialog, ipcMain, nativeImage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { ApplyFeedbackInput, BrandTokens, DemoRef, FeedbackAnchor, GenerateOptions, NewClientInput, NewDemoInput, RunEvent, Settings, ShareInfo, ShareTargetInput } from "../common/types";
import { BrandService, type PageCapture } from "./brand";
import { HIDE_OVERLAYS_JS, pageExtractor, type BrandRaw } from "./brand-extract";
import { checkClaude, findClaude } from "./claude";
import { DemoService } from "./demos";
import { Library } from "./library";
import { PreviewServer } from "./preview";
import { SecretStore } from "./secrets";
import { ShareClient } from "./share";
import { SettingsStore } from "./settings";

// The kit's templates ship next to its package.json (in M6: copied into the app resources).
process.env.PROTOTYPER_TEMPLATES_DIR ??= join(
  dirname(createRequire(import.meta.url).resolve("@prototyper/prototype-kit/package.json")),
  "templates",
);

// Dev/testing: isolate settings and library from the real ones.
if (process.env.PROTOTYPER_USER_DATA) app.setPath("userData", process.env.PROTOTYPER_USER_DATA);
const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
if (process.env.PROTOTYPER_LIBRARY) void settings.set({ libraryRoot: process.env.PROTOTYPER_LIBRARY });
const secrets = new SecretStore(join(app.getPath("userData"), "secrets.json"));
const preview = new PreviewServer();

function shareClient(targetId: string): ShareClient {
  const target = settings.get().shareTargets?.find((t) => t.id === targetId);
  if (!target) throw new Error("Unknown share domain. Check Settings.");
  const token = secrets.get(targetId);
  if (!token) throw new Error(`No admin token for ${target.name}. Check Settings.`);
  return new ShareClient(target, token);
}

/** Validate and normalize a share target base URL: https only (http allowed for localhost). */
function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Share domains must use https://");
  return `${url.protocol}//${url.host}`;
}
let mainWindow: BrowserWindow | undefined;

const send = (channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

const library = () => new Library(settings.get().libraryRoot);

const brand = new BrandService({
  library,
  settings: () => settings.get(),
  capturePage,
  thumbnail,
});

const demos = new DemoService({
  library,
  settings: () => settings.get(),
  preview,
  emit: (ref: DemoRef, event: RunEvent) => send("demo:event", { ref, event }),
  changed: (ref: DemoRef) => send("demo:changed", ref),
  capture: captureThumbnail,
  shareClient,
  captureArea,
  brand,
  screenshotUrl: async (url) => (await capturePage(url, { mobile: false, extract: false })).desktop,
  thumbnail,
  notify: (ref, title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on("click", () => {
      mainWindow?.show();
      send("app:openDemo", ref);
    });
    n.show();
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Render a website offscreen in a throwaway session: hide cookie banners, scroll through
 * to trigger lazy loading, run the brand extractor, take full-page screenshots.
 */
async function capturePage(url: string, opts: { mobile: boolean; extract?: boolean }): Promise<PageCapture> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    // A dedicated session keeps the client's cookies away from the app; it is cleared after each capture.
    // (In-memory partitions hang on load in offscreen windows, hence a persistent one.)
    webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false, partition: "persist:capture" },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(30);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const work = async (): Promise<PageCapture> => {
    // Entrance animations (content fading in from opacity 0) never finish in a hidden window unless
    // it keeps rendering; asking for reduced motion makes most sites show content immediately.
    // CDP needs a loaded page before it answers, hence about:blank first.
    await win.loadURL("about:blank");
    try {
      win.webContents.debugger.attach("1.3");
      await Promise.race([
        win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }),
        sleep(3000),
      ]);
    } catch {
      /* best effort */
    }
    await Promise.race([
      win.loadURL(url, { userAgent: DESKTOP_UA }),
      sleep(30_000).then(() => {
        throw new Error(`Timed out loading ${url}`);
      }),
    ]).catch((e: Error) => {
      // Some sites never fire "load" (long-polling, trackers): keep going if the DOM is there.
      if (!/Timed out|ERR_ABORTED/.test(e.message)) throw e;
    });
    await sleep(1200);
    await win.webContents.executeJavaScript(HIDE_OVERLAYS_JS);
    await win.webContents.executeJavaScript(
      "(async () => { const h = Math.min(document.documentElement.scrollHeight, 9000); for (let y = 0; y < h; y += 700) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); })()",
    );
    await sleep(600);
    const raw = (opts.extract ?? true)
      ? ((await win.webContents.executeJavaScript(`(${pageExtractor.toString()})()`)) as BrandRaw)
      : ({} as BrandRaw);
    const desktop = await fullPage(win, 1440, 5000);
    let mobile: Buffer | undefined;
    if (opts.mobile) mobile = await fullPage(win, 390, 4000);
    return { raw, desktop, ...(mobile ? { mobile } : {}) };
  };
  try {
    return await Promise.race([
      work(),
      sleep(90_000).then((): never => {
        throw new Error(`Capturing ${url} took too long.`);
      }),
    ]);
  } finally {
    const session = win.webContents.session;
    win.destroy();
    await session.clearStorageData().catch(() => {});
  }
}

/** Resize the offscreen window to the page height (capped) and capture it as JPEG. */
async function fullPage(win: BrowserWindow, width: number, maxHeight: number): Promise<Buffer> {
  win.setSize(width, 900);
  await sleep(500);
  const h = (await win.webContents.executeJavaScript("document.documentElement.scrollHeight")) as number;
  const height = Math.max(600, Math.min(h, maxHeight));
  win.setSize(width, height);
  await sleep(300);
  // An offscreen window does not repaint on resize by itself: force a frame and wait for it.
  const painted = new Promise<void>((resolve) => win.webContents.once("paint", () => resolve()));
  win.webContents.invalidate();
  await Promise.race([painted, sleep(3000)]);
  await sleep(600);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  return image.toJPEG(80);
}

/** Small data-URL preview of an image file. SVGs are returned as they are. */
async function thumbnail(file: string, width: number): Promise<string | undefined> {
  if (file.toLowerCase().endsWith(".svg")) {
    const svg = await readFile(file).catch(() => undefined);
    return svg ? `data:image/svg+xml;base64,${svg.toString("base64")}` : undefined;
  }
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) {
    const size = await stat(file).then((s) => s.size, () => Infinity);
    if (size > 2_000_000) return undefined;
    const ext = file.split(".").pop()?.toLowerCase();
    const mime = ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : ext === "ico" ? "image/x-icon" : "image/png";
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  }
  const resized = img.getSize().width > width ? img.resize({ width }) : img;
  return `data:image/jpeg;base64,${resized.toJPEG(78).toString("base64")}`;
}

/**
 * Screenshot the area a client note points at: scroll the anchored element into view,
 * mark the note's exact spot, crop around it.
 */
async function captureArea(pageUrl: string, anchor: FeedbackAnchor, outPath: string): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false } });
  try {
    await win.loadURL(pageUrl);
    await sleep(500);
    const box = (await win.webContents.executeJavaScript(`(() => {
      const a = ${JSON.stringify(anchor)};
      let el = null;
      if (a.key) el = document.querySelector('[data-pt="' + CSS.escape(a.key) + '"], [data-pt-bg="' + CSS.escape(a.key) + '"]');
      else if (a.selector) { try { el = document.querySelector(a.selector); } catch {} }
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const px = r.left + a.x * r.width, py = r.top + a.y * r.height;
      const m = document.createElement("div");
      m.style.cssText = "position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:#f05a28;box-shadow:0 0 0 3px #fff,0 2px 10px rgba(0,0,0,.45);left:" + px + "px;top:" + py + "px";
      document.body.appendChild(m);
      return { x: r.left, y: r.top, w: r.width, h: r.height, px, py, vw: innerWidth, vh: innerHeight };
    })()`)) as { x: number; y: number; w: number; h: number; px: number; py: number; vw: number; vh: number } | null;
    if (!box) return;
    await sleep(200);
    // Frame the whole element (plus margin) when it fits; otherwise center on the note's spot.
    const width = Math.round(Math.min(box.vw, 1200, Math.max(900, box.w + 160)));
    const height = Math.round(Math.min(box.vh, 800, Math.max(500, box.h + 160)));
    const fits = box.w + 160 <= width && box.h + 160 <= height;
    const cx = fits ? box.x + box.w / 2 : box.px;
    const cy = fits ? box.y + box.h / 2 : box.py;
    const x = Math.round(Math.min(Math.max(0, cx - width / 2), box.vw - width));
    const y = Math.round(Math.min(Math.max(0, cy - height / 2), box.vh - height));
    const image = await win.webContents.capturePage({ x, y, width, height });
    await writeFile(outPath, image.toPNG());
  } finally {
    win.destroy();
  }
}

/** Render a page offscreen and save a 640px-wide PNG. */
async function captureThumbnail(url: string, outPath: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { offscreen: true, sandbox: true, javascript: true, backgroundThrottling: false },
  });
  try {
    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, 600)); // fonts and images
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 800 });
    await writeFile(outPath, image.resize({ width: 640 }).toPNG());
  } finally {
    win.destroy();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Prototyper",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f6f6f4",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  // Links clicked in the app UI open in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.PROTOTYPER_SNAPSHOT) void devSnapshot(mainWindow, process.env.PROTOTYPER_SNAPSHOT);

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

/**
 * Dev only: after load, optionally run PROTOTYPER_SNAPSHOT_JS in the renderer, wait, save a
 * screenshot of the window to `path`, then quit. Used to check the UI from scripts.
 */
async function devSnapshot(win: BrowserWindow, path: string): Promise<void> {
  // A window in the background stops repainting and capturePage returns a stale frame.
  win.webContents.setBackgroundThrottling(false);
  await new Promise<void>((r) => win.webContents.once("did-finish-load", () => r()));
  await new Promise((r) => setTimeout(r, 1500));
  if (process.env.PROTOTYPER_SNAPSHOT_JS) {
    const result: unknown = await win.webContents.executeJavaScript(process.env.PROTOTYPER_SNAPSHOT_JS);
    if (result !== undefined) console.log("[snapshot]", JSON.stringify(result));
    await new Promise((r) => setTimeout(r, Number(process.env.PROTOTYPER_SNAPSHOT_WAIT ?? 2500)));
  }
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 300));
  await writeFile(path, (await win.webContents.capturePage()).toPNG());
  app.exit(0);
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)));

  handle("settings:get", () => settings.get());
  handle("settings:set", (patch: Partial<Settings>) => settings.set(patch));
  handle("settings:chooseFolder", async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? undefined : r.filePaths[0];
  });

  handle("claude:check", () => checkClaude(settings.get().claudePath));

  handle("share:targets", () => (settings.get().shareTargets ?? []).map((t) => ({ ...t, hasToken: secrets.has(t.id) })));
  handle("share:saveTarget", async (input: ShareTargetInput) => {
    const targets = settings.get().shareTargets ?? [];
    const id = input.id ?? randomUUID();
    const target = { id, name: input.name.trim() || new URL(normalizeBaseUrl(input.baseUrl)).hostname, baseUrl: normalizeBaseUrl(input.baseUrl) };
    if (input.adminToken !== undefined && input.adminToken.trim()) await secrets.set(id, input.adminToken.trim());
    if (!secrets.has(id)) throw new Error("The admin token is required.");
    await settings.set({ shareTargets: [...targets.filter((t) => t.id !== id), target] });
    return target;
  });
  handle("share:removeTarget", async (id: string) => {
    await settings.set({ shareTargets: (settings.get().shareTargets ?? []).filter((t) => t.id !== id) });
    await secrets.set(id, undefined);
  });
  handle("share:testTarget", async (id: string) => {
    await shareClient(id).health();
    return true;
  });

  handle("library:list", () => library().list());
  handle("library:createClient", (input: NewClientInput) => library().createClient(input));

  handle("demo:create", (input: NewDemoInput) => demos.create(input));
  handle("demo:detail", (ref: DemoRef) => demos.detail(ref));
  handle("demo:log", (ref: DemoRef) => demos.log(ref));
  handle("demo:open", (ref: DemoRef) => demos.open(ref));
  handle("demo:close", (ref: DemoRef) => demos.close(ref));
  // Long-running tasks: return immediately, progress arrives as events.
  const start = (ref: DemoRef, run: () => Promise<void>) => {
    if (demos.isRunning(ref)) throw new Error("Claude is already working on this demo.");
    run().catch((e: unknown) => console.error(e));
  };
  handle("demo:generate", (ref: DemoRef, opts: GenerateOptions) => start(ref, () => demos.generate(ref, opts)));
  handle("demo:references", (ref: DemoRef) => demos.listReferences(ref));
  handle("demo:addReferenceFiles", (ref: DemoRef, paths: string[]) => demos.addReferenceFiles(ref, paths));
  handle("demo:addReferenceImage", (ref: DemoRef, data: Uint8Array, ext: string) => demos.addReferenceImage(ref, data, ext));
  handle("demo:addReferenceUrl", (ref: DemoRef, url: string, note: string) => demos.addReferenceUrl(ref, url, note));
  handle("demo:setReferenceNote", (ref: DemoRef, file: string, note: string) => demos.setReferenceNote(ref, file, note));
  handle("demo:removeReference", (ref: DemoRef, file: string) => demos.removeReference(ref, file));

  const extracting = new Set<string>();
  handle("brand:info", (client: string) => brand.info(client));
  handle("brand:extract", async (client: string, website: string) => {
    if (extracting.has(client)) throw new Error("Brand extraction is already running for this client.");
    extracting.add(client);
    try {
      return await brand.extract(client, website, (event) => send("brand:event", { client, event }));
    } finally {
      extracting.delete(client);
    }
  });
  handle("brand:saveTokens", (client: string, tokens: BrandTokens) => brand.saveTokens(client, tokens));
  handle("brand:saveMd", (client: string, text: string) => brand.saveBrandMd(client, text));
  handle("demo:approveStructure", (ref: DemoRef, feedback: string) => start(ref, () => demos.approveStructure(ref, feedback)));
  handle("demo:chat", (ref: DemoRef, text: string) => start(ref, () => demos.chat(ref, text)));
  handle("demo:cancel", (ref: DemoRef) => demos.cancel(ref));
  handle("demo:saveVersion", (ref: DemoRef, summary: string) => demos.saveVersion(ref, summary));
  handle("demo:publish", (ref: DemoRef, targetId: string) => demos.publish(ref, targetId));
  handle("demo:setShareStatus", (ref: DemoRef, status: ShareInfo["status"]) => demos.setShareStatus(ref, status));
  handle("demo:rounds", (ref: DemoRef) => demos.rounds(ref));
  handle("demo:loadFeedback", (ref: DemoRef) => demos.loadFeedback(ref));
  handle("demo:applyFeedback", (ref: DemoRef, input: ApplyFeedbackInput) => start(ref, () => demos.applyFeedback(ref, input)));
  handle("share:poll", () => demos.pollShares());
  handle("demo:openFolder", (ref: DemoRef) => shell.openPath(library().demoDir(ref)));
  handle("demo:openInBrowser", async (ref: DemoRef) => shell.openExternal((await demos.detail(ref)).previewUrl));
  handle("demo:openTerminal", async (ref: DemoRef) => {
    const dir = library().demoDir(ref);
    const meta = await library().readMeta(ref);
    const bin = (await findClaude(settings.get().claudePath)) ?? "claude";
    const cmd = `cd ${shq(dir)} && ${shq(bin)}${meta.claudeSessionId ? ` --resume ${shq(meta.claudeSessionId)}` : ""}`;
    await new Promise<void>((resolve, reject) =>
      execFile(
        "osascript",
        ["-e", `tell application "Terminal" to do script ${JSON.stringify(cmd)}`, "-e", 'tell application "Terminal" to activate'],
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  });
}

/** Single-quote for POSIX shells. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

app.whenReady().then(async () => {
  await mkdir(settings.get().libraryRoot, { recursive: true });
  await preview.start();
  registerIpc();
  createWindow();
  // Check share servers for client activity: soon after start, then every 3 minutes.
  setTimeout(() => void demos.pollShares(), 5_000);
  setInterval(() => void demos.pollShares(), 3 * 60_000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => preview.stop());
