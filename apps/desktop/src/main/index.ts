import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import type { DemoRef, NewClientInput, NewDemoInput, RunEvent, Settings, ShareInfo, ShareTargetInput } from "../common/types";
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

const demos = new DemoService({
  library,
  settings: () => settings.get(),
  preview,
  emit: (ref: DemoRef, event: RunEvent) => send("demo:event", { ref, event }),
  changed: (ref: DemoRef) => send("demo:changed", ref),
  capture: captureThumbnail,
  shareClient,
});

/** Render a page offscreen and save a 640px-wide PNG. */
async function captureThumbnail(url: string, outPath: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { offscreen: true, sandbox: true, javascript: true },
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
  await new Promise<void>((r) => win.webContents.once("did-finish-load", () => r()));
  await new Promise((r) => setTimeout(r, 1500));
  if (process.env.PROTOTYPER_SNAPSHOT_JS) {
    await win.webContents.executeJavaScript(process.env.PROTOTYPER_SNAPSHOT_JS);
    await new Promise((r) => setTimeout(r, Number(process.env.PROTOTYPER_SNAPSHOT_WAIT ?? 2500)));
  }
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
  handle("demo:generate", (ref: DemoRef, opts: { structureFirst: boolean }) => start(ref, () => demos.generate(ref, opts)));
  handle("demo:approveStructure", (ref: DemoRef, feedback: string) => start(ref, () => demos.approveStructure(ref, feedback)));
  handle("demo:chat", (ref: DemoRef, text: string) => start(ref, () => demos.chat(ref, text)));
  handle("demo:cancel", (ref: DemoRef) => demos.cancel(ref));
  handle("demo:saveVersion", (ref: DemoRef, summary: string) => demos.saveVersion(ref, summary));
  handle("demo:publish", (ref: DemoRef, targetId: string) => demos.publish(ref, targetId));
  handle("demo:setShareStatus", (ref: DemoRef, status: ShareInfo["status"]) => demos.setShareStatus(ref, status));
  handle("demo:rounds", (ref: DemoRef) => demos.rounds(ref));
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => preview.stop());
