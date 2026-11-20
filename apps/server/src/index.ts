import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { randomToken, sha256 } from "./security.js";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

const here = dirname(fileURLToPath(import.meta.url));

/** The overlay bundle sits next to the built server; in development it comes from the overlay package. */
function loadOverlay(): string {
  const bundled = join(here, "review.js");
  if (existsSync(bundled)) return readFileSync(bundled, "utf8");
  return readFileSync(createRequire(import.meta.url).resolve("@prototyper/overlay/review.js"), "utf8");
}

const { app, store, ctx } = await buildApp({
  dataDir: env("DATA_DIR", "./data"),
  secretKey: env("SECRET_KEY"),
  panelHost: env("PANEL_HOST"),
  overlayJs: loadOverlay(),
  panelDir: process.env.PANEL_DIR ?? join(here, "panel"),
  trustProxy: env("TRUST_PROXY", "false") === "true",
  ...(process.env.DEV_HTTP === "true" ? { devPort: Number(env("PORT", "3700")) } : {}),
  logger: process.argv[2] === undefined,
});

// `node server.js create-admin <email>`: create (or re-invite) an admin and print an invite link.
if (process.argv[2] === "create-admin") {
  const email = (process.argv[3] ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Usage: node server.js create-admin <email>");
    process.exit(1);
  }
  const user = store.userByEmail(email) ?? store.createUser({ id: randomUUID(), email, isAdmin: true });
  store.updateUser(user.id, { is_admin: 1, disabled: 0 });
  const token = randomToken();
  store.createInvite(sha256(token), user.id, new Date(Date.now() + 7 * 86_400_000).toISOString());
  store.audit(null, "admin.create_cli", { user: user.id, email });
  console.log(`Open this link to set the password of ${email} (valid 7 days):\n${ctx.panelOrigin}/invite/${token}`);
  await app.close();
  process.exit(0);
}

const port = Number(env("PORT", "3700"));
const host = env("HOST", "127.0.0.1");
await app.listen({ port, host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
