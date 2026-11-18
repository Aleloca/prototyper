import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const ADMIN = "x".repeat(40);
const auth = { authorization: `Bearer ${ADMIN}` };
const HOST = "preview.example.com";

let dir: string;
let app: FastifyInstance;

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

async function publish(projectId: string, number: number, pages: Record<string, string> = { "index.html": PAGE, "assets/a.svg": "<svg/>" }) {
  await app.inject({ method: "PUT", url: `/api/admin/projects/${projectId}`, headers: auth, payload: { name: "Demo" } });
  const v = await app.inject({
    method: "POST",
    url: `/api/admin/projects/${projectId}/versions?number=${number}&changelog=${encodeURIComponent(`v${number} notes`)}`,
    headers: { ...auth, "content-type": "application/gzip" },
    payload: await siteTarball(pages),
  });
  expect(v.statusCode, v.body).toBe(200);
  const s = await app.inject({ method: "PUT", url: `/api/admin/projects/${projectId}/share`, headers: auth, payload: { host: HOST } });
  expect(s.statusCode, s.body).toBe(200);
  return s.json() as { token: string };
}

const pub = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, host = HOST) =>
  app.inject({ method, url, headers: { host }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pt-server-"));
  ({ app } = await buildApp({ dataDir: dir, adminToken: ADMIN, overlayJs: "/*overlay*/" }));
});

afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("admin auth", () => {
  it("rejects missing or wrong tokens", async () => {
    expect((await app.inject({ url: "/api/admin/health" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/admin/health", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/admin/health", headers: auth })).json()).toEqual({ ok: true });
  });
});

describe("review round", () => {
  it("serves the demo, stores edits, uploads, comments and submission", async () => {
    const id = randomUUID();
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

    // The app reads the feedback, then closes the round with replies.
    const rounds = (await app.inject({ url: `/api/admin/projects/${id}/rounds`, headers: auth })).json();
    expect(rounds).toMatchObject([{ status: "submitted", edits: 3, comments: 1, versionNumber: 1 }]);
    const fb = (await app.inject({ url: `/api/admin/rounds/${rounds[0].id}/feedback`, headers: auth })).json();
    expect(fb.edits.find((e: { key: string }) => e.key === "home.hero.title")).toMatchObject({ before: { kind: "text", text: "Ciao" }, value: { kind: "text", text: "Benvenuti" }, author: "Anna" });
    expect(fb.uploads).toHaveLength(1);
    expect((await app.inject({ url: `/api/admin/uploads/${upload.id}`, headers: auth })).statusCode).toBe(200);

    await app.inject({ method: "POST", url: `/api/admin/rounds/${rounds[0].id}/imported`, headers: auth, payload: { replies: { [commentId]: { status: "resolved", reply: "Fatto!" } } } });
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
    const { token } = await publish(randomUUID(), 1);
    expect((await pub("GET", `/s/${token}/`, undefined, "other.example.com")).statusCode).toBe(404);
    expect((await pub("GET", `/s/${token}/..%2F..%2Fprototyper.db`)).statusCode).toBe(404);
    expect((await pub("GET", `/s/not-a-token/`)).statusCode).toBe(404);

    await app.inject({ method: "PATCH", url: `/api/admin/shares/${token}`, headers: auth, payload: { status: "readonly" } });
    expect((await pub("GET", `/s/${token}/__pt/state`)).json()).toMatchObject({ editable: false, shareStatus: "readonly" });
    expect((await pub("POST", `/s/${token}/__pt/comments`, { page: "index.html", anchor: { x: 0, y: 0 }, text: "x", author: "A" })).statusCode).toBe(409);

    await app.inject({ method: "PATCH", url: `/api/admin/shares/${token}`, headers: auth, payload: { status: "revoked" } });
    expect((await pub("GET", `/s/${token}/`)).statusCode).toBe(404);
  });

  it("does not leak uploads across projects", async () => {
    const a = await publish(randomUUID(), 1);
    const b = await publish(randomUUID(), 1);
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
    const id = randomUUID();
    await app.inject({ method: "PUT", url: `/api/admin/projects/${id}`, headers: auth, payload: { name: "Demo" } });
    const r = await app.inject({ method: "POST", url: `/api/admin/projects/${id}/versions?number=1`, headers: { ...auth, "content-type": "application/gzip" }, payload: await siteTarball({ "about.html": PAGE }) });
    expect(r.statusCode).toBe(400);
  });
});
