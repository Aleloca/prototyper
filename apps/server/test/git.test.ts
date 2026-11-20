import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { Store } from "../src/db";
import { randomToken, sha256 } from "../src/security";
import { BehindError, SourceRepo, type Remote } from "../../../packages/mcp/src/git";

// A real HTTP server and real git: the MCP's SourceRepo against the server's git endpoint.
const PANEL = "127.0.0.1";
const author = { name: "Dev", email: "dev@example.com" };

let dir: string;
let app: FastifyInstance;
let store: Store;
let token: string;
let projectId: string;
let remote: Remote;

async function files(root: string, map: Record<string, string>) {
  for (const [path, body] of Object.entries(map)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), body);
  }
}

async function siteTarball(): Promise<Buffer> {
  const src = await mkdtemp(join(tmpdir(), "pt-site-"));
  await writeFile(join(src, "index.html"), "<!doctype html><title>T</title><h1>Hi</h1>");
  const chunks: Buffer[] = [];
  for await (const c of tar.c({ gzip: true, cwd: src, portable: true }, ["."]) as AsyncIterable<Buffer>) chunks.push(c);
  await rm(src, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

const publish = async (commit?: string) =>
  app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/versions?changelog=x${commit ? `&commit=${commit}` : ""}`,
    headers: { host: PANEL, authorization: `Bearer ${token}`, "content-type": "application/gzip" },
    payload: await siteTarball(),
  });

/** Clone the project's sources into a new folder, as clone_project does. */
async function clone(): Promise<{ root: string; repo: SourceRepo }> {
  const root = join(dir, `work-${randomUUID().slice(0, 8)}`);
  await mkdir(root);
  const repo = await SourceRepo.open(root);
  const head = (await repo.remoteHead(remote))!;
  await repo.fetch(remote, head);
  await repo.checkout(head);
  await repo.setBase(head);
  return { root, repo };
}

/** Commit and push the folder's sources, as publish does. */
async function push(repo: SourceRepo, buildDir?: string): Promise<string> {
  const head = await repo.remoteHead(remote);
  const base = await repo.base();
  if (head && head !== base) throw new BehindError("behind");
  const commit = await repo.snapshot("change", author, head ?? base, buildDir);
  if (commit !== head) await repo.push(remote, commit);
  await repo.setBase(commit);
  return commit;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pt-git-"));
  ({ app, store } = await buildApp({ dataDir: join(dir, "data"), secretKey: "s".repeat(40), panelHost: PANEL, overlayJs: "" }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const ws = store.createWorkspace(randomUUID(), "Agency").id;
  store.updateDomain(store.createDomain(randomUUID(), ws, "preview.example.com").id, { status: "active" });
  const uid = randomUUID();
  store.createUser({ id: uid, email: "dev@example.com", name: "Dev" });
  store.updateUser(uid, { totp_enabled: 1 });
  store.addMember(ws, uid);
  token = randomToken();
  store.createApiToken({ id: randomUUID(), user_id: uid, name: "t", token_hash: sha256(token), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  const r = await app.inject({ method: "POST", url: "/api/v1/projects", headers: { host: PANEL, authorization: `Bearer ${token}` }, payload: { workspaceId: ws, client: "Rossi", name: "Demo" } });
  projectId = (r.json() as { id: string }).id;
  remote = { url: `http://127.0.0.1:${port}/git/${projectId}.git`, token };
});

afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("project sources (internal git)", () => {
  it("pushes the sources without secrets, dependencies or the build, and links them to the version", async () => {
    const a = join(dir, "a");
    await files(a, {
      "index.html": "<h1>Hi</h1>",
      "src/app.js": "one\ntwo\nthree\n",
      ".env": "SECRET=1",
      ".env.example": "SECRET=",
      "node_modules/x/index.js": "x",
      "dist/index.html": "<h1>built</h1>",
      ".gitignore": "*.log\n",
      "debug.log": "noise",
    });
    const repo = await SourceRepo.open(a);
    expect(await repo.remoteHead(remote)).toBeUndefined();
    const commit = await push(repo, join(a, "dist"));

    const tree = execFileSync("git", ["--git-dir", join(dir, "data", "git", `${projectId}.git`), "ls-tree", "-r", "--name-only", commit]).toString().split("\n").filter(Boolean);
    expect(tree.sort()).toEqual([".env.example", ".gitignore", "index.html", "src/app.js"]);
    // The user's own git ignores Prototyper's folder.
    expect(await readFile(join(a, ".prototyper", ".gitignore"), "utf8")).toBe("*\n");

    const v = await publish(commit);
    expect(v.statusCode, v.body).toBe(200);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}`, headers: { host: PANEL, authorization: `Bearer ${token}` } })).json() as {
      versions: { commit: string | null; source: string | null }[];
    };
    expect(detail.versions[0]!.commit).toBe(commit);
    expect(detail.versions[0]!.source).toMatch(/source\.zip$/);
    const tag = execFileSync("git", ["--git-dir", join(dir, "data", "git", `${projectId}.git`), "rev-parse", "refs/tags/v1"]).toString().trim();
    expect(tag).toBe(commit);

    // A commit that was never pushed can't be attached to a version.
    expect((await publish("0".repeat(40))).statusCode).toBe(400);
    const info = (await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/source`, headers: { host: PANEL, authorization: `Bearer ${token}` } })).json() as { git: string; head: string };
    expect(info.git.endsWith(`/git/${projectId}.git`)).toBe(true);
    expect(info.head).toBe(commit);
  });

  it("clones, refuses to publish over a teammate's work, and merges it", async () => {
    const first = join(dir, "first");
    await files(first, { "index.html": "<h1>Hi</h1>", "src/app.js": "one\ntwo\nthree\n" });
    await push(await SourceRepo.open(first));

    const alice = await clone();
    const bob = await clone();
    expect(await readFile(join(alice.root, "src/app.js"), "utf8")).toBe("one\ntwo\nthree\n");

    await writeFile(join(alice.root, "src/app.js"), "ONE\ntwo\nthree\n");
    await push(alice.repo);

    await writeFile(join(bob.root, "src/app.js"), "one\ntwo\nTHREE\n");
    await writeFile(join(bob.root, "new.css"), "a{}");
    await expect(push(bob.repo)).rejects.toBeInstanceOf(BehindError);

    const head = (await bob.repo.remoteHead(remote))!;
    await bob.repo.fetch(remote, head);
    expect(await bob.repo.merge(head, author)).toEqual([]);
    expect(await readFile(join(bob.root, "src/app.js"), "utf8")).toBe("ONE\ntwo\nTHREE\n");
    expect(await readFile(join(bob.root, "new.css"), "utf8")).toBe("a{}");
    await push(bob.repo);

    // Same line changed on both sides: conflict markers in the file.
    const carol = await clone();
    await writeFile(join(alice.root, "src/app.js"), "alice\n");
    const ah = (await alice.repo.remoteHead(remote))!;
    await alice.repo.fetch(remote, ah);
    await alice.repo.merge(ah, author);
    await writeFile(join(alice.root, "src/app.js"), "alice\n");
    await push(alice.repo);
    await writeFile(join(carol.root, "src/app.js"), "carol\n");
    const ch = (await carol.repo.remoteHead(remote))!;
    await carol.repo.fetch(remote, ch);
    expect(await carol.repo.merge(ch, author)).toContain("src/app.js");
    expect(await readFile(join(carol.root, "src/app.js"), "utf8")).toMatch(/<<<<<<<[\s\S]*carol[\s\S]*=======[\s\S]*alice[\s\S]*>>>>>>>/);
  });

  it("needs a valid token", async () => {
    const root = join(dir, "x");
    await mkdir(root);
    const repo = await SourceRepo.open(root);
    await expect(repo.remoteHead({ ...remote, token: "nope" })).rejects.toThrow();
    const r = await app.inject({ method: "GET", url: `/git/${projectId}.git/info/refs?service=git-upload-pack`, headers: { host: PANEL } });
    expect(r.statusCode).toBe(401);
    expect(r.headers["www-authenticate"]).toMatch(/Basic/);
  });
});
