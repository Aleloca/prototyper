import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** The overlay bundle sits next to the built server; in development it comes from the overlay package. */
function loadOverlay(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "review.js");
  if (existsSync(bundled)) return readFileSync(bundled, "utf8");
  return readFileSync(createRequire(import.meta.url).resolve("@prototyper/overlay/review.js"), "utf8");
}

const adminToken = env("ADMIN_TOKEN");
if (adminToken.length < 32) throw new Error("ADMIN_TOKEN must be at least 32 characters");

const { app } = await buildApp({
  dataDir: env("DATA_DIR", "./data"),
  adminToken,
  overlayJs: loadOverlay(),
  trustProxy: env("TRUST_PROXY", "false") === "true",
  logger: true,
});

const port = Number(env("PORT", "3700"));
const host = env("HOST", "127.0.0.1");
await app.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
