import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";

const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;

/** Only `main` can be pushed; tags (`v1`, `v2`…) are set by the server when a version is published. */
const PRE_RECEIVE = `#!/bin/sh
while read old new ref; do
  if [ "$ref" != "refs/heads/main" ]; then echo "Prototyper: only main can be pushed (got $ref)" >&2; exit 1; fi
  if [ "$new" = "0000000000000000000000000000000000000000" ]; then echo "Prototyper: main can't be deleted" >&2; exit 1; fi
done
`;

export type GitService = "git-upload-pack" | "git-receive-pack";

/**
 * The sources of each project, as a bare git repository per project (`<root>/<projectId>.git`),
 * served over git's smart HTTP protocol (through `git http-backend`) to the signed-in MCP user.
 * Each published version points to the commit it was built from.
 */
export class GitRepos {
  private ready: Promise<boolean> | undefined;

  constructor(
    private readonly root: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Whether git is installed on the server (checked once). */
  available(): Promise<boolean> {
    this.ready ??= exec("git", ["--version"]).then(
      () => true,
      () => {
        this.log.warn("git is not installed: project sources are not kept (install git, or use the Docker image)");
        return false;
      },
    );
    return this.ready;
  }

  private dir(projectId: string): string {
    if (!UUID.test(projectId)) throw new Error("bad project id");
    return join(this.root, `${projectId}.git`);
  }

  private git(projectId: string, args: string[]) {
    return exec("git", ["--git-dir", this.dir(projectId), ...args], { maxBuffer: 16 * 1024 * 1024 });
  }

  async ensure(projectId: string): Promise<void> {
    const dir = this.dir(projectId);
    if (await stat(join(dir, "HEAD")).then(() => true, () => false)) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await exec("git", ["init", "--quiet", "--bare", "--initial-branch=main", dir]);
    for (const [k, v] of [
      ["http.receivepack", "true"],
      ["receive.denyNonFastForwards", "true"],
      ["receive.denyDeletes", "true"],
      ["receive.fsckObjects", "true"],
      ["core.logAllRefUpdates", "true"],
    ] as const)
      await exec("git", ["--git-dir", dir, "config", k, v]);
    await writeFile(join(dir, "hooks", "pre-receive"), PRE_RECEIVE);
    await chmod(join(dir, "hooks", "pre-receive"), 0o755);
  }

  /** The commit `main` points to, if anything was pushed. */
  async head(projectId: string): Promise<string | undefined> {
    const out = await this.git(projectId, ["rev-parse", "--verify", "--quiet", "refs/heads/main"]).catch(() => undefined);
    const sha = out?.stdout.trim();
    return sha && SHA.test(sha) ? sha : undefined;
  }

  /** True if `sha` is a commit already pushed to `main` (the version being published was built from it). */
  async onMain(projectId: string, sha: string): Promise<boolean> {
    if (!SHA.test(sha)) return false;
    return this.git(projectId, ["merge-base", "--is-ancestor", sha, "refs/heads/main"]).then(
      () => true,
      () => false,
    );
  }

  async tag(projectId: string, number: number, sha: string): Promise<void> {
    await this.git(projectId, ["update-ref", `refs/tags/v${number}`, sha]);
  }

  /** Zip of the sources at a commit. */
  archive(projectId: string, sha: string, prefix: string): Readable {
    if (!SHA.test(sha)) throw new Error("bad commit");
    const child = spawn("git", ["--git-dir", this.dir(projectId), "archive", "--format=zip", `--prefix=${prefix}/`, sha], { stdio: ["ignore", "pipe", "ignore"] });
    return child.stdout;
  }

  async remove(projectId: string): Promise<void> {
    await rm(this.dir(projectId), { recursive: true, force: true });
  }

  /** Which service a smart-HTTP request is for (anything else is refused). */
  static service(rest: string, query: Record<string, string | undefined>, method: string): GitService | undefined {
    if (method === "GET" && rest === "info/refs") {
      const s = query.service;
      return s === "git-upload-pack" || s === "git-receive-pack" ? s : undefined;
    }
    if (method === "POST" && (rest === "git-upload-pack" || rest === "git-receive-pack")) return rest;
    return undefined;
  }

  /** Run `git http-backend` for a request (CGI) and stream its answer. */
  async serve(req: FastifyRequest, reply: FastifyReply, projectId: string, rest: string, remoteUser: string): Promise<void> {
    await this.ensure(projectId);
    const query = req.raw.url?.split("?")[1] ?? "";
    const child = spawn("git", ["http-backend"], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        GIT_PROJECT_ROOT: this.root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: `/${projectId}.git/${rest}`,
        REQUEST_METHOD: req.method,
        QUERY_STRING: query,
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        REMOTE_USER: remoteUser,
        REMOTE_ADDR: req.ip,
        ...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: String(req.headers["content-encoding"]) } : {}),
        ...(req.headers["git-protocol"] ? { GIT_PROTOCOL: String(req.headers["git-protocol"]) } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (d: Buffer) => this.log.debug({ project: projectId, git: d.toString().trim() }, "git http-backend"));
    if (req.method === "POST") (req.body as Readable).pipe(child.stdin);
    else child.stdin.end();

    reply.hijack();
    const res = reply.raw;
    let head = Buffer.alloc(0);
    let headersSent = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (headersSent) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n") >= 0 ? head.indexOf("\r\n\r\n") : head.indexOf("\n\n");
      if (end < 0) return;
      const sep = head[end] === 0x0d ? 4 : 2;
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.subarray(0, end).toString("latin1").split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === "status") status = Number.parseInt(v, 10) || 200;
        else headers[k] = v;
      }
      res.writeHead(status, { ...headers, "Cache-Control": "no-store" });
      headersSent = true;
      const body = head.subarray(end + sep);
      if (body.length) res.write(body);
    });
    child.on("close", (code) => {
      if (!headersSent) res.writeHead(code === 0 ? 200 : 500);
      res.end();
    });
    child.on("error", () => {
      if (!headersSent) res.writeHead(500);
      res.end();
    });
  }
}
