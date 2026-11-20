import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { randomToken, sha256 } from "./security.js";
import { httpRedirectServer, sniFromCertsDir } from "./standalone.js";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

const here = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];

/** The overlay bundle sits next to the built server; in development it comes from the overlay package. */
function loadOverlay(): string {
  const bundled = join(here, "review.js");
  if (existsSync(bundled)) return readFileSync(bundled, "utf8");
  return readFileSync(createRequire(import.meta.url).resolve("@prototyper/overlay/review.js"), "utf8");
}

/** SECRET_KEY from the environment, or one generated on first start and kept in the data folder. */
function secretKey(dataDir: string): string {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const file = join(dataDir, "secret.key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, key + "\n", { mode: 0o600, flag: "wx" });
  return key;
}

const dataDir = env("DATA_DIR", "./data");
const certsDir = process.env.CERTS_DIR;
const standalone = process.env.STANDALONE === "true" && command === undefined;
if (standalone && !certsDir) throw new Error("STANDALONE=true needs CERTS_DIR (where the HTTPS certificates are kept)");

const { app, store, ctx } = await buildApp({
  dataDir,
  secretKey: secretKey(dataDir),
  panelHost: env("PANEL_HOST"),
  overlayJs: loadOverlay(),
  panelDir: process.env.PANEL_DIR ?? join(here, "panel"),
  trustProxy: env("TRUST_PROXY", "false") === "true",
  thumbnails: process.env.THUMBNAILS !== "false" && command === undefined,
  ...(process.env.DEV_HTTP === "true" ? { devPort: Number(env("PORT", "3700")) } : {}),
  ...(certsDir
    ? { acme: { certsDir, staging: process.env.ACME_STAGING === "true", ...(process.env.ACME_EMAIL ? { email: process.env.ACME_EMAIL } : {}) } }
    : {}),
  ...(standalone ? { https: { SNICallback: sniFromCertsDir(certsDir!) } } : {}),
  logger: command === undefined,
});

/** Create (or re-invite) an admin; returns the invite link to set the password. */
function inviteAdmin(email: string): string {
  const user = store.userByEmail(email) ?? store.createUser({ id: randomUUID(), email, isAdmin: true });
  store.updateUser(user.id, { is_admin: 1, disabled: 0 });
  const token = randomToken();
  store.createInvite(sha256(token), user.id, new Date(Date.now() + 7 * 86_400_000).toISOString());
  store.audit(null, "admin.create_cli", { user: user.id, email });
  return `${ctx.panelOrigin}/invite/${token}`;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// `node server.js create-admin <email>`: create (or re-invite) an admin and print an invite link.
if (command === "create-admin") {
  const email = (process.argv[3] ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) {
    console.error("Usage: create-admin <email>");
    process.exit(1);
  }
  console.log(`Open this link to set the password of ${email} (valid 7 days):\n${inviteAdmin(email)}`);
  await app.close();
  process.exit(0);
}

// First start with no users: ADMIN_EMAIL becomes the first admin.
const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
if (adminEmail && store.users().length === 0) {
  if (!EMAIL.test(adminEmail)) throw new Error(`ADMIN_EMAIL is not a valid email: ${adminEmail}`);
  const link = inviteAdmin(adminEmail);
  console.log(`\n  First admin: ${adminEmail}\n  Open this link to set the password (valid 7 days):\n  ${link}\n`);
}

const host = env("HOST", "127.0.0.1");
let redirect: ReturnType<typeof httpRedirectServer> | undefined;
if (standalone) {
  await app.listen({ port: Number(env("HTTPS_PORT", "443")), host });
  const http = (redirect = httpRedirectServer(app));
  await new Promise<void>((resolve, reject) => http.once("error", reject).listen(Number(env("HTTP_PORT", "80")), host, resolve));
} else {
  await app.listen({ port: Number(env("PORT", "3700")), host });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    redirect?.close();
    void app.close().then(() => process.exit(0));
  });
}
