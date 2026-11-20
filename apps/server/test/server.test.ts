import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { Store } from "../src/db";
import { hashPassword, randomToken, sha256, totpCode, totpStep } from "../src/security";
import type { Ctx } from "../src/context";

const PANEL = "panel.example.com";
const ORIGIN = `https://${PANEL}`;
const HOST = "preview.example.com";
const SECRET = "s".repeat(40);

let dir: string;
let app: FastifyInstance;
let store: Store;
let ctx: Ctx;
let ws: string;
let token: string; // API token of a member of `ws` with 2FA
let auth: Record<string, string>;

const PAGE = `<!doctype html><html lang="it"><head><title>T</title></head><body>
<h1 data-pt="home.hero.title">Ciao</h1>
<p data-pt="home.hero.lead" data-pt-type="rich">Testo <b>ricco</b></p>
<img data-pt="home.hero.image" src="assets/a.svg" alt="A">
<a href="about.html"><span data-pt="global.nav.about">Chi siamo</span></a>
</body></html>`;

async function siteTarball(pages: Record<string, string>): Promise<Buffer> {
  const src = await mkdtemp(join(tmpdir(), "pt-site-"));
  for (const [path, html] of Object.entries(pages)) {
    await mkdir(join(src, path, ".."), { recursive: true });
    await writeFile(join(src, path), html);
  }
  const chunks: Buffer[] = [];
  const stream = tar.c({ gzip: true, cwd: src, portable: true }, ["."]);
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c);
  await rm(src, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

const api = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method, url, headers: { host: PANEL, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function createProject(name = "Demo", workspaceId = ws): Promise<string> {
  const r = await api("POST", "/api/v1/projects", { workspaceId, client: "Studio Rossi", name });
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as { id: string }).id;
}

/** Publish a version through the MCP API; returns the review token. */
async function publish(projectId: string, number: number, pages: Record<string, string> = { "index.html": PAGE, "assets/a.svg": "<svg/>" }) {
  const v = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/versions?changelog=${encodeURIComponent(`v${number} notes`)}`,
    headers: { ...auth, host: PANEL, "content-type": "application/gzip" },
    payload: await siteTarball(pages),
  });
  expect(v.statusCode, v.body).toBe(200);
  const body = v.json() as { url: string; version: { number: number } };
  expect(body.version.number).toBe(number);
  return { token: /\/s\/([\w-]+)\//.exec(body.url)![1]!, url: body.url };
}

const pub = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, host = HOST) =>
  app.inject({ method, url, headers: { host }, ...(payload !== undefined ? { payload: payload as object } : {}) });

/** A user with password "password-123" and optionally 2FA; returns the TOTP secret. */
async function makeUser(email: string, opts: { admin?: boolean; totp?: boolean; workspace?: string } = {}) {
  const id = randomUUID();
  store.createUser({ id, email, name: email.split("@")[0]!, isAdmin: opts.admin ?? false });
  const secret = "JBSWY3DPEHPK3PXP";
  store.updateUser(id, { password_hash: await hashPassword("password-123"), ...(opts.totp ? { totp_secret: ctx.box.seal(secret), totp_enabled: 1 } : {}) });
  if (opts.workspace) store.addMember(opts.workspace, id);
  return { id, secret };
}

function apiToken(userId: string): string {
  const t = randomToken();
  store.createApiToken({ id: randomUUID(), user_id: userId, name: "test", token_hash: sha256(t), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  return t;
}

/** Sign in to the panel; returns the cookie header. */
async function login(email: string, secret?: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email, password: "password-123" } });
  expect(r.statusCode, r.body).toBe(200);
  let cookie = String(r.headers["set-cookie"]).split(";")[0]!;
  if ((r.json() as { mfaRequired?: boolean }).mfaRequired) {
    const m = await app.inject({ method: "POST", url: "/api/panel/login/mfa", headers: { host: PANEL, origin: ORIGIN, cookie }, payload: { code: totpCode(secret!, totpStep()) } });
    expect(m.statusCode, m.body).toBe(200);
    cookie = String(m.headers["set-cookie"]).split(";")[0]!;
  }
  return cookie;
}

const panel = (cookie: string) => (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { host: PANEL, origin: ORIGIN, cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pt-server-"));
  ({ app, store, ctx } = await buildApp({ dataDir: dir, secretKey: SECRET, panelHost: PANEL, overlayJs: "/*overlay*/" }));
  ws = store.createWorkspace(randomUUID(), "Agency").id;
  const d = store.createDomain(randomUUID(), ws, HOST);
  store.updateDomain(d.id, { status: "active" });
  const member = await makeUser("dev@example.com", { totp: true, workspace: ws });
  token = apiToken(member.id);
  auth = { authorization: `Bearer ${token}` };
});

afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("review round", () => {
  it("serves the demo, stores edits, uploads, comments and submission", async () => {
    const id = await createProject();
    const { token } = await publish(id, 1);

    const page = await pub("GET", `/s/${token}/`);
    expect(page.statusCode).toBe(200);
    expect(page.headers["x-robots-tag"]).toContain("noindex");
    expect(page.body).toContain('<script src="/__pt/review.js" defer></script></body>');
    expect(page.body).toContain(`"page":"index.html"`);

    // Edits are validated against the published content and applied when serving.
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.hero.title`, { value: { kind: "text", text: "Benvenuti" }, page: "index.html", author: "Anna" })).statusCode).toBe(200);
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.hero.title`, { value: { kind: "image", src: "x" }, page: "index.html", author: "Anna" })).statusCode).toBe(400);
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.nope.title`, { value: { kind: "text", text: "x" }, page: "index.html", author: "Anna" })).statusCode).toBe(404);
    const rich = await pub("PUT", `/s/${token}/__pt/edits/home.hero.lead`, { value: { kind: "rich", html: 'Ok <script>x</script><em>sì</em>' }, page: "index.html", author: "Anna" });
    expect(rich.json().value).toEqual({ kind: "rich", html: "Ok <em>sì</em>" });
    // Arbitrary image URLs are refused; only own uploads.
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.hero.image`, { value: { kind: "image", src: "https://evil.example/x.png" }, page: "index.html", author: "Anna" })).statusCode).toBe(400);

    const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#c33" } }).png().toBuffer();
    const boundary = "----pt";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nhome.hero.image\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({ method: "POST", url: `/s/${token}/__pt/uploads`, headers: { host: HOST, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(up.statusCode, up.body).toBe(200);
    const upload = up.json() as { id: string; src: string; width: number };
    expect(upload.width).toBe(2400);
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.hero.image`, { value: { kind: "image", src: upload.src, alt: "Nuova" }, page: "index.html", author: "Anna" })).statusCode).toBe(200);
    const img = await pub("GET", upload.src);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");

    const after = await pub("GET", `/s/${token}/index.html`);
    expect(after.body).toContain('data-pt="home.hero.title">Benvenuti</h1>');
    expect(after.body).toContain(`src="${upload.src}" alt="Nuova"`);

    const comment = await pub("POST", `/s/${token}/__pt/comments`, { page: "index.html", anchor: { key: "home.hero.title", x: 0.5, y: 0.2 }, text: "Più grande?", author: "Anna" });
    expect(comment.statusCode).toBe(200);
    const commentId = (comment.json() as { id: string }).id;

    const state = (await pub("GET", `/s/${token}/__pt/state`)).json();
    expect(state.editable).toBe(true);
    expect(state.edits.map((e: { key: string }) => e.key).sort()).toEqual(["home.hero.image", "home.hero.lead", "home.hero.title"]);
    expect(state.originals["home.hero.title"]).toEqual({ kind: "text", text: "Ciao" });

    expect((await pub("POST", `/s/${token}/__pt/submit`, { author: "Anna" })).json().status).toBe("submitted");

    // Claude (through the MCP API) reads the feedback, then closes the round with replies.
    const detail = (await api("GET", `/api/v1/projects/${id}`)).json();
    expect(detail.rounds).toMatchObject([{ status: "submitted", edits: 3, comments: 1, versionNumber: 1 }]);
    const fb = (await api("GET", `/api/v1/projects/${id}/feedback`)).json();
    expect(fb.edits.find((e: { key: string }) => e.key === "home.hero.title")).toMatchObject({ before: { kind: "text", text: "Ciao" }, value: { kind: "text", text: "Benvenuti" }, author: "Anna" });
    expect(fb.uploads).toMatchObject([{ id: upload.id, url: `/api/v1/uploads/${upload.id}` }]);
    expect((await api("GET", `/api/v1/uploads/${upload.id}`)).statusCode).toBe(200);

    expect((await api("POST", `/api/v1/rounds/${fb.round.id}/imported`, { replies: { [commentId]: { status: "resolved", reply: "Fatto!" } } })).statusCode).toBe(200);
    expect((await pub("GET", `/s/${token}/__pt/state`)).json().editable).toBe(false);
    expect((await pub("PUT", `/s/${token}/__pt/edits/home.hero.title`, { value: { kind: "text", text: "x" }, page: "index.html", author: "A" })).statusCode).toBe(409);

    // Next version: same link, fresh round, previous notes with replies, changelog.
    const again = await publish(id, 2);
    expect(again.token).toBe(token);
    const s2 = (await pub("GET", `/s/${token}/__pt/state`)).json();
    expect(s2).toMatchObject({ editable: true, version: { number: 2, changelog: "v2 notes" }, edits: [], comments: [] });
    expect(s2.previousComments).toMatchObject([{ id: commentId, status: "resolved", reply: "Fatto!" }]);
    expect((await pub("GET", `/s/${token}/`)).body).toContain(">Ciao</h1>");
  });
});

describe("access control", () => {
  it("hides shares on other hosts, revoked shares and path traversal", async () => {
    const id = await createProject();
    const { token } = await publish(id, 1);
    const admin = await makeUser("boss@example.com", { admin: true });
    const as = panel(await login("boss@example.com"));
    void admin;
    expect((await pub("GET", `/s/${token}/`, undefined, "other.example.com")).statusCode).toBe(404);
    expect((await pub("GET", `/s/${token}/..%2F..%2Fprototyper.db`)).statusCode).toBe(404);
    expect((await pub("GET", `/s/not-a-token/`)).statusCode).toBe(404);

    expect((await as("PATCH", `/api/panel/projects/${id}/share`, { status: "readonly" })).statusCode).toBe(200);
    expect((await pub("GET", `/s/${token}/__pt/state`)).json()).toMatchObject({ editable: false, shareStatus: "readonly" });
    expect((await pub("POST", `/s/${token}/__pt/comments`, { page: "index.html", anchor: { x: 0, y: 0 }, text: "x", author: "A" })).statusCode).toBe(409);

    // Review links are never served on the panel host.
    expect((await pub("GET", `/s/${token}/`, undefined, PANEL)).statusCode).toBe(404);
    expect((await as("PATCH", `/api/panel/projects/${id}/share`, { status: "revoked" })).statusCode).toBe(200);
    expect((await pub("GET", `/s/${token}/`)).statusCode).toBe(404);
  });

  it("does not leak uploads across projects", async () => {
    const a = await publish(await createProject("A"), 1);
    const b = await publish(await createProject("B"), 1);
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    const boundary = "----pt";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nhome.hero.image\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = (await app.inject({ method: "POST", url: `/s/${a.token}/__pt/uploads`, headers: { host: HOST, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body })).json() as { id: string };
    expect((await pub("GET", `/s/${b.token}/__pt/uploads/${up.id}`)).statusCode).toBe(404);
    expect((await pub("GET", `/s/${a.token}/__pt/uploads/${up.id}`)).statusCode).toBe(200);
  });

  it("rejects tarballs without index.html", async () => {
    const id = await createProject();
    const r = await app.inject({ method: "POST", url: `/api/v1/projects/${id}/versions`, headers: { ...auth, host: PANEL, "content-type": "application/gzip" }, payload: await siteTarball({ "about.html": PAGE }) });
    expect(r.statusCode).toBe(400);
  });
});

describe("panel sign-in", () => {
  it("signs in with password, then TOTP when 2FA is on, and refuses replays", async () => {
    const { secret } = await makeUser("anna@example.com", { totp: true, workspace: ws });
    const wrong = await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email: "anna@example.com", password: "nope-nope-nope" } });
    expect(wrong.statusCode).toBe(401);

    const r = await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email: "ANNA@example.com", password: "password-123" } });
    expect(r.json()).toEqual({ mfaRequired: true });
    const pending = String(r.headers["set-cookie"]).split(";")[0]!;
    // Half-signed-in sessions can't use the API.
    expect((await panel(pending)("GET", "/api/panel/me")).statusCode).toBe(401);
    expect((await panel(pending)("POST", "/api/panel/login/mfa", { code: "000000" })).statusCode).toBe(401);
    const code = totpCode(secret, totpStep());
    const ok = await panel(pending)("POST", "/api/panel/login/mfa", { code });
    expect(ok.statusCode, ok.body).toBe(200);
    const cookie = String(ok.headers["set-cookie"]).split(";")[0]!;
    expect(cookie).not.toBe(pending);
    expect((await panel(cookie)("GET", "/api/panel/me")).json()).toMatchObject({ user: { email: "anna@example.com", totpEnabled: true }, workspaces: [{ id: ws, name: "Agency" }] });

    // The same code can't be used twice.
    const again = await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email: "anna@example.com", password: "password-123" } });
    const c2 = String(again.headers["set-cookie"]).split(";")[0]!;
    expect((await panel(c2)("POST", "/api/panel/login/mfa", { code })).statusCode).toBe(401);
  });

  it("locks an account after repeated failures", async () => {
    await makeUser("lock@example.com");
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email: "lock@example.com", password: "wrong-wrong" } });
    }
    const r = await app.inject({ method: "POST", url: "/api/panel/login", headers: { host: PANEL, origin: ORIGIN }, payload: { email: "lock@example.com", password: "password-123" } });
    expect(r.statusCode).toBe(429);
  });

  it("refuses cross-site requests and the panel API on preview hosts", async () => {
    await makeUser("x@example.com");
    const cookie = await login("x@example.com");
    const evil = await app.inject({ method: "PUT", url: "/api/panel/me", headers: { host: PANEL, origin: "https://evil.example", cookie }, payload: { name: "x" } });
    expect(evil.statusCode).toBe(403);
    const noOrigin = await app.inject({ method: "PUT", url: "/api/panel/me", headers: { host: PANEL, cookie }, payload: { name: "x" } });
    expect(noOrigin.statusCode).toBe(403);
    expect((await app.inject({ url: "/api/panel/me", headers: { host: HOST, cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/v1/me", headers: { host: HOST, ...auth } })).statusCode).toBe(404);
  });

  it("enables and disables 2FA; disabling revokes MCP tokens", async () => {
    const { id } = await makeUser("t@example.com", { workspace: ws });
    const as = panel(await login("t@example.com"));
    const setup = await as("POST", "/api/panel/me/2fa/setup", { password: "password-123" });
    expect(setup.statusCode, setup.body).toBe(200);
    const { secret, otpauthUrl } = setup.json() as { secret: string; otpauthUrl: string };
    expect(otpauthUrl).toContain(`secret=${secret}`);
    expect((await as("POST", "/api/panel/me/2fa/enable", { code: "123456" })).statusCode).toBe(400);
    expect((await as("POST", "/api/panel/me/2fa/enable", { code: totpCode(secret, totpStep()) })).json()).toMatchObject({ user: { totpEnabled: true } });

    const t = apiToken(id);
    expect((await api("GET", "/api/v1/me", undefined, { authorization: `Bearer ${t}` })).statusCode).toBe(200);
    expect((await as("GET", "/api/panel/me/tokens")).json()).toHaveLength(1);
    const off = await as("POST", "/api/panel/me/2fa/disable", { password: "password-123", code: totpCode(secret, totpStep() + 1) });
    expect(off.statusCode, off.body).toBe(200);
    expect((await api("GET", "/api/v1/me", undefined, { authorization: `Bearer ${t}` })).statusCode).toBe(401);
  });
});

describe("admin and workspaces", () => {
  it("invites users, who set their password and see only their workspaces", async () => {
    await makeUser("boss@example.com", { admin: true });
    const boss = panel(await login("boss@example.com"));
    const other = (await boss("POST", "/api/panel/admin/workspaces", { name: "Other" })).json() as { id: string };

    const created = await boss("POST", "/api/panel/admin/users", { email: "New@Example.com", workspaceIds: [other.id] });
    expect(created.statusCode, created.body).toBe(200);
    const { inviteUrl } = created.json() as { inviteUrl: string };
    expect(inviteUrl.startsWith(`${ORIGIN}/invite/`)).toBe(true);
    const inviteToken = inviteUrl.split("/").at(-1)!;

    const anon = panel("");
    expect((await anon("GET", `/api/panel/invites/${inviteToken}`)).json()).toMatchObject({ email: "new@example.com", reset: false });
    expect((await anon("POST", `/api/panel/invites/${inviteToken}`, { name: "Nuovo", password: "short" })).statusCode).toBe(400);
    expect((await anon("POST", `/api/panel/invites/${inviteToken}`, { name: "Nuovo", password: "password-123" })).statusCode).toBe(200);
    expect((await anon("GET", `/api/panel/invites/${inviteToken}`)).statusCode).toBe(404);

    // The new member sees "Other" only; "Agency" (where the demo project is) stays hidden.
    const projectId = await createProject();
    const nu = panel(await login("new@example.com"));
    expect((await nu("GET", "/api/panel/me")).json().workspaces).toEqual([{ id: other.id, name: "Other" }]);
    expect((await nu("GET", `/api/panel/workspaces/${ws}`)).statusCode).toBe(404);
    expect((await nu("GET", `/api/panel/projects/${projectId}`)).statusCode).toBe(404);
    expect((await nu("GET", "/api/panel/admin/users")).statusCode).toBe(403);

    // Admins see every workspace and can add the member to it.
    expect((await boss("GET", `/api/panel/workspaces/${ws}`)).json().projects).toHaveLength(1);
    const newId = (created.json() as { user: { id: string } }).user.id;
    expect((await boss("PUT", `/api/panel/admin/workspaces/${ws}/members/${newId}`)).statusCode).toBe(200);
    expect((await nu("GET", `/api/panel/projects/${projectId}`)).json()).toMatchObject({ name: "Demo", client: { name: "Studio Rossi" } });

    // Disabling a user ends their sessions.
    expect((await boss("PATCH", `/api/panel/admin/users/${newId}`, { disabled: true })).statusCode).toBe(200);
    expect((await nu("GET", "/api/panel/me")).statusCode).toBe(401);
  });

  it("scopes the MCP API to the user's workspaces", async () => {
    const other = store.createWorkspace(randomUUID(), "Other").id;
    const r = await api("POST", "/api/v1/projects", { workspaceId: other, client: "X", name: "Y" });
    expect(r.statusCode).toBe(404);
    const me = (await api("GET", "/api/v1/me")).json();
    expect(me.workspaces).toMatchObject([{ id: ws, name: "Agency", domains: [{ hostname: HOST }] }]);
    expect((await api("GET", "/api/v1/me", undefined, { authorization: "Bearer nope" })).statusCode).toBe(401);
  });

  it("refuses to publish without an active preview domain, and serves signed version previews", async () => {
    const bare = store.createWorkspace(randomUUID(), "Bare").id;
    const { id: uid } = await makeUser("b@example.com", { totp: true, workspace: bare });
    const h = { authorization: `Bearer ${apiToken(uid)}` };
    const p = (await api("POST", "/api/v1/projects", { workspaceId: bare, client: "C", name: "P" }, h)).json() as { id: string };
    const v = await app.inject({ method: "POST", url: `/api/v1/projects/${p.id}/versions`, headers: { ...h, host: PANEL, "content-type": "application/gzip" }, payload: await siteTarball({ "index.html": PAGE }) });
    expect(v.statusCode).toBe(409);

    const id = await createProject();
    await publish(id, 1);
    await publish(id, 2, { "index.html": PAGE.replace("Ciao", "Hello") });
    const detail = (await api("GET", `/api/v1/projects/${id}`)).json() as { versions: { number: number; previewUrl: string }[] };
    const v1 = new URL(detail.versions.find((x) => x.number === 1)!.previewUrl);
    expect(v1.host).toBe(HOST);
    const page = await pub("GET", v1.pathname);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(">Ciao</h1>");
    expect(page.body).not.toContain("review.js");
    expect((await pub("GET", v1.pathname.replace(/\.[\w-]+\/$/, ".forged/"))).statusCode).toBe(404);
  });
});
