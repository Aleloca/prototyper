import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

let logFile: string | undefined;

/** Append a line to ~/Library/Logs/Prototyper/main.log. Never throws. */
export function log(...parts: unknown[]): void {
  try {
    if (!logFile) {
      const dir = app.getPath("logs");
      mkdirSync(dir, { recursive: true });
      logFile = join(dir, "main.log");
    }
    const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break the app */
  }
}

/** Record crashes and renderer errors, and reload the window if its renderer dies. */
export function watchWindow(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.on("render-process-gone", (_e, details) => {
    log("render-process-gone", details);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && wc.reload(), 500);
  });
  wc.on("unresponsive", () => log("window unresponsive"));
  wc.on("console-message", (e) => {
    if (e.level === "error") log("renderer error:", e.message.slice(0, 2000), e.sourceId ? `(${e.sourceId}:${e.lineNumber})` : "");
  });
  wc.on("did-fail-load", (_e, code, desc, url) => log("did-fail-load", code, desc, url));
}

export function watchApp(): void {
  app.on("child-process-gone", (_e, details) => log("child-process-gone", details));
  process.on("uncaughtException", (e) => log("main uncaughtException", e.stack ?? String(e)));
  process.on("unhandledRejection", (e) => log("main unhandledRejection", e instanceof Error ? (e.stack ?? e.message) : String(e)));
}
