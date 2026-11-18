import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sharp from "sharp";
import * as tar from "tar";
import { z } from "zod";
import {
  ContentValue,
  KEY_PATTERN,
  applyEdits,
  lintDemo,
  readSite,
  sanitizeRich,
  type ContentEdit,
  type ContentEntry,
} from "@prototyper/shared";
import { Store, type CommentRow, type RoundRow, type ShareRow, type VersionRow } from "./db.js";

export interface ServerConfig {
  dataDir: string;
  adminToken: string;
  /** Contents of the overlay bundle served at /__pt/review.js. */
  overlayJs: string;
  trustProxy?: boolean;
  logger?: boolean;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

const SAFE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const ACCEPTED_IMAGES = new Set(["jpeg", "png", "webp", "avif", "gif"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2400;

const AuthorSchema = z.string().trim().min(1).max(80);
const AnchorSchema = z.object({
  key: z.string().max(200).optional(),
  selector: z.string().max(1000).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  viewportWidth: z.number().int().min(0).max(10000).optional(),
});

/** Public shape of a comment (also used by the overlay). */
function commentDto(c: CommentRow) {
  return {
    id: c.id,
    page: c.page,
    anchor: JSON.parse(c.anchor_json) as unknown,
    text: c.text,
    author: c.author,
    status: c.status,
    reply: c.reply,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function roundDto(r: RoundRow, store: Store) {
  return {
    id: r.id,
    versionNumber: store.version(r.version_id)?.number ?? null,
    status: r.status,
    openedAt: r.opened_at,
    submittedAt: r.submitted_at,
    submittedBy: r.submitted_by,
    importedAt: r.imported_at,
  };
}

export async function buildApp(config: ServerConfig): Promise<{ app: FastifyInstance; store: Store }> {
  await mkdir(join(config.dataDir, "projects"), { recursive: true });
  await mkdir(join(config.dataDir, "uploads"), { recursive: true });
  const store = new Store(join(config.dataDir, "prototyper.db"));

  const app = Fastify({
    logger: config.logger ?? false,
    trustProxy: config.trustProxy ?? false,
    bodyLimit: 1024 * 1024,
  });
  app.addHook("onClose", async () => store.close());

  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });
  app.addContentTypeParser(["application/gzip", "application/x-gzip", "application/octet-stream"], { parseAs: "buffer", bodyLimit: 200 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid_request", details: err.issues });
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: code >= 500 ? "internal_error" : err.message });
  });

  // --- content of published versions (cached) ------------------------------------------------

  const contentCache = new Map<number, Map<string, ContentEntry>>();
  async function versionContent(v: VersionRow): Promise<Map<string, ContentEntry>> {
    let c = contentCache.get(v.id);
    if (!c) {
      c = lintDemo(await readSite(v.dir)).content;
      contentCache.set(v.id, c);
    }
    return c;
  }

  // --- admin API --------------------------------------------------------------------------

  const adminToken = Buffer.from(config.adminToken);
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? "";
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (given.length !== adminToken.length || !timingSafeEqual(given, adminToken)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };

  await app.register(async (admin) => {
    admin.addHook("onRequest", requireAdmin);

    admin.get("/api/admin/health", async () => ({ ok: true }));

    admin.put("/api/admin/projects/:id", async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
      return store.upsertProject(id, name);
    });

    admin.post("/api/admin/projects/:id/versions", async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const q = z.object({ number: z.coerce.number().int().min(1), changelog: z.string().max(20_000).default("") }).parse(req.query);
      if (!store.project(id)) return reply.code(404).send({ error: "unknown_project" });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: "expected a tar.gz body" });

      const dir = join(config.dataDir, "projects", id, `v${q.number}`);
      const tmp = `${dir}.tmp-${randomUUID()}`;
      await mkdir(tmp, { recursive: true });
      try {
        await new Promise<void>((resolve, reject) => {
          const x = tar.x({ cwd: tmp, strict: true, filter: (path) => !path.split("/").some((p) => p === "..") });
          x.on("error", reject).on("close", resolve).on("finish", resolve);
          Readable.from(req.body as Buffer).pipe(x);
        });
        const site = await readSite(tmp);
        if (!site.pages.some((p) => p.path === "index.html")) throw Object.assign(new Error("index.html missing"), { statusCode: 400 });
        await rm(dir, { recursive: true, force: true });
        await rename(tmp, dir);
      } catch (e) {
        await rm(tmp, { recursive: true, force: true });
        throw e;
      }
      const version = store.putVersion(id, q.number, q.changelog, dir);
      contentCache.delete(version.id);
      return { id: version.id, number: version.number, publishedAt: version.published_at };
    });

    /** Create the share, or point it to the latest version (opening a new review round). */
    admin.put("/api/admin/projects/:id/share", async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ host: z.string().max(253).nullable().default(null) }).parse(req.body ?? {});
      const latest = store.latestVersion(id);
      if (!latest) return reply.code(409).send({ error: "no_version" });
      const host = body.host?.toLowerCase() ?? null;

      return store.transaction(() => {
        let share = store.shareForProject(id);
        share = share
          ? store.updateShare(share.token, { host, versionId: latest.id })
          : store.createShare(randomBytes(32).toString("base64url"), id, latest.id, host);
        const current = store.currentRound(id);
        if (!current || current.version_id !== latest.id) store.openRound(id, latest.id);
        return { token: share.token, host: share.host, status: share.status, versionNumber: latest.number };
      });
    });

    admin.patch("/api/admin/shares/:token", async (req, reply) => {
      const { token } = z.object({ token: z.string() }).parse(req.params);
      const { status } = z.object({ status: z.enum(["open", "readonly", "revoked"]) }).parse(req.body);
      if (!store.share(token)) return reply.code(404).send({ error: "unknown_share" });
      const s = store.updateShare(token, { status });
      return { token: s.token, status: s.status };
    });

    admin.get("/api/admin/projects/:id/rounds", async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return store.rounds(id).map((r) => ({
        ...roundDto(r, store),
        edits: store.edits(r.id).length,
        comments: store.comments(r.id).length,
      }));
    });

    admin.get("/api/admin/rounds/:id/feedback", async (req, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      const round = store.round(id);
      if (!round) return reply.code(404).send({ error: "unknown_round" });
      const version = store.version(round.version_id)!;
      const content = await versionContent(version);
      return {
        round: roundDto(round, store),
        edits: store.edits(id).map((e) => ({
          key: e.key,
          page: e.page,
          value: JSON.parse(e.value_json) as unknown,
          before: content.get(e.key)?.value ?? null,
          author: e.author,
          updatedAt: e.updated_at,
        })),
        uploads: store.uploads(id).map((u) => ({ id: u.id, key: u.key, mime: u.mime, width: u.width, height: u.height })),
        comments: store.comments(id).map(commentDto),
      };
    });

    admin.get("/api/admin/uploads/:id", async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const u = store.upload(id);
      if (!u) return reply.code(404).send({ error: "unknown_upload" });
      return reply.type(u.mime).send(createReadStream(u.file));
    });

    admin.post("/api/admin/rounds/:id/imported", async (req, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      const { replies } = z
        .object({
          replies: z.record(z.string(), z.object({ status: z.enum(["resolved", "answered", "open"]), reply: z.string().max(5000).optional() })).default({}),
        })
        .parse(req.body ?? {});
      if (!store.round(id)) return reply.code(404).send({ error: "unknown_round" });
      return roundDto(store.markImported(id, replies), store);
    });
  });

  // --- overlay bundle -------------------------------------------------------------------

  app.get("/__pt/review.js", async (_req, reply) =>
    reply.headers({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" }).send(config.overlayJs),
  );

  app.get("/", async (_req, reply) => reply.headers(SAFE_HEADERS).type("text/plain").send("Prototyper"));

  // --- public share routes ----------------------------------------------------------------

  /** Resolve a share for a public request: unknown token, wrong host and revoked links all look the same. */
  const resolveShare = (req: FastifyRequest, token: string): { share: ShareRow; version: VersionRow; round: RoundRow } | undefined => {
    const share = store.share(token);
    if (!share || share.status === "revoked") return undefined;
    if (share.host && share.host !== req.hostname.toLowerCase().replace(/:\d+$/, "")) return undefined;
    const version = store.version(share.version_id);
    const round = store.currentRound(share.project_id);
    if (!version || !round) return undefined;
    return { share, version, round };
  };

  const notFound = (reply: FastifyReply) =>
    reply
      .code(404)
      .headers(SAFE_HEADERS)
      .type("text/html; charset=utf-8")
      .send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#555">This link is not available.</body>');

  /** Whether the client may still change things in this round. */
  const editable = (share: ShareRow, round: RoundRow) => share.status === "open" && round.status !== "imported";

  await app.register(async (pub) => {
    await pub.register(rateLimit, { max: 600, timeWindow: "1 minute" });

    pub.get("/s/:token", async (req, reply) => {
      const { token } = req.params as { token: string };
      if (!resolveShare(req, token)) return notFound(reply);
      return reply.redirect(`/s/${token}/`);
    });

    pub.get("/s/:token/__pt/state", async (req, reply) => {
      const { token } = req.params as { token: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      const { share, version, round } = ctx;
      const content = await versionContent(version);
      const edits = store.edits(round.id);
      const previous = store.rounds(share.project_id).filter((r) => r.id < round.id && r.status === "imported").at(-1);
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" }).send({
        editable: editable(share, round),
        shareStatus: share.status,
        version: { number: version.number, changelog: version.changelog, publishedAt: version.published_at },
        round: roundDto(round, store),
        edits: edits.map((e) => ({ key: e.key, page: e.page, value: JSON.parse(e.value_json) as unknown, author: e.author, updatedAt: e.updated_at })),
        originals: Object.fromEntries(edits.map((e) => [e.key, content.get(e.key)?.value ?? null])),
        comments: store.comments(round.id).map(commentDto),
        previousComments: previous ? store.comments(previous.id).map(commentDto) : [],
      });
    });

    pub.put("/s/:token/__pt/edits/:key", async (req, reply) => {
      const { token, key } = req.params as { token: string; key: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      if (!KEY_PATTERN.test(key)) return reply.code(400).send({ error: "invalid_key" });
      const body = z.object({ value: ContentValue, page: z.string().max(500), author: AuthorSchema }).parse(req.body);

      const original = (await versionContent(ctx.version)).get(key);
      if (!original) return reply.code(404).send({ error: "unknown_key" });
      if (original.kind !== body.value.kind) return reply.code(400).send({ error: "kind_mismatch" });

      let value = body.value;
      if (value.kind === "rich") value = { kind: "rich", html: sanitizeRich(value.html) };
      if ((value.kind === "image" || value.kind === "bg") && !isAllowedImageSrc(value.src, token, original.value)) {
        return reply.code(400).send({ error: "invalid_image_src" });
      }
      store.putEdit(ctx.round.id, key, body.page, JSON.stringify(value), body.author);
      return { ok: true, value };
    });

    pub.delete("/s/:token/__pt/edits/:key", async (req, reply) => {
      const { token, key } = req.params as { token: string; key: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      const { author } = z.object({ author: AuthorSchema }).parse(req.query);
      store.deleteEdit(ctx.round.id, key, author);
      return { ok: true };
    });

    pub.post(
      "/s/:token/__pt/uploads",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const { token } = req.params as { token: string };
        const ctx = resolveShare(req, token);
        if (!ctx) return notFound(reply);
        if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });

        const file = await req.file();
        if (!file) return reply.code(400).send({ error: "no_file" });
        const key = z.string().regex(KEY_PATTERN).parse((file.fields.key as { value?: string } | undefined)?.value);
        const input = await file.toBuffer();
        if (file.file.truncated) return reply.code(413).send({ error: "too_large" });

        let meta;
        try {
          meta = await sharp(input, { limitInputPixels: 80_000_000 }).metadata();
        } catch {
          return reply.code(400).send({ error: "not_an_image" });
        }
        if (!meta.format || !ACCEPTED_IMAGES.has(meta.format)) return reply.code(400).send({ error: "unsupported_format" });

        const { data, info } = await sharp(input, { limitInputPixels: 80_000_000 })
          .rotate()
          .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer({ resolveWithObject: true });

        const id = randomUUID();
        const path = join(config.dataDir, "uploads", `${id}.webp`);
        await writeFile(path, data);
        store.addUpload({ id, round_id: ctx.round.id, key, file: path, mime: "image/webp", width: info.width, height: info.height });
        return { id, src: `/s/${token}/__pt/uploads/${id}`, width: info.width, height: info.height };
      },
    );

    pub.get("/s/:token/__pt/uploads/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const ctx = resolveShare(req, token);
      const u = ctx && z.string().uuid().safeParse(id).success ? store.upload(id) : undefined;
      // Uploads are only visible through the share of the project they belong to.
      if (!ctx || !u || store.round(u.round_id)?.project_id !== ctx.share.project_id) return notFound(reply);
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "private, max-age=86400" }).type(u.mime).send(createReadStream(u.file));
    });

    pub.post("/s/:token/__pt/comments", async (req, reply) => {
      const { token } = req.params as { token: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      const body = z.object({ page: z.string().max(500), anchor: AnchorSchema, text: z.string().trim().min(1).max(5000), author: AuthorSchema }).parse(req.body);
      const c = store.addComment({ id: randomUUID(), round_id: ctx.round.id, page: body.page, anchor_json: JSON.stringify(body.anchor), text: body.text, author: body.author });
      return commentDto(c);
    });

    pub.patch("/s/:token/__pt/comments/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      const c = store.comment(id);
      if (!c || c.round_id !== ctx.round.id) return reply.code(404).send({ error: "unknown_comment" });
      const { text } = z.object({ text: z.string().trim().min(1).max(5000) }).parse(req.body);
      return commentDto(store.updateComment(id, text));
    });

    pub.delete("/s/:token/__pt/comments/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      const c = store.comment(id);
      if (!c || c.round_id !== ctx.round.id) return reply.code(404).send({ error: "unknown_comment" });
      store.deleteComment(id);
      return { ok: true };
    });

    pub.post("/s/:token/__pt/submit", async (req, reply) => {
      const { token } = req.params as { token: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);
      if (!editable(ctx.share, ctx.round)) return reply.code(409).send({ error: "read_only" });
      const { author } = z.object({ author: AuthorSchema }).parse(req.body);
      return roundDto(store.submitRound(ctx.round.id, author), store);
    });

    /** The demo itself: current version files, with the round's edits applied and the overlay injected. */
    pub.get("/s/:token/*", async (req, reply) => {
      const { token } = req.params as { token: string };
      const ctx = resolveShare(req, token);
      if (!ctx) return notFound(reply);

      let rel = decodeURIComponent((req.params as { "*": string })["*"] ?? "");
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const root = ctx.version.dir;
      const file = normalize(join(root, rel));
      if (!file.startsWith(root + sep)) return notFound(reply);
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) return notFound(reply);

      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      if (!type.startsWith("text/html")) {
        return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "private, max-age=60" }).type(type).send(createReadStream(file));
      }

      const edits: ContentEdit[] = store.edits(ctx.round.id).map((e) => ({ key: e.key, value: JSON.parse(e.value_json) as ContentValue }));
      let html = applyEdits(await readFile(file, "utf8"), edits).html;
      html = injectOverlay(html, {
        token,
        page: rel.split(sep).join("/"),
        api: `/s/${token}/__pt`,
      });
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" }).type(type).send(html);
    });
  });

  return { app, store };
}

/** Images set by the client must be their own uploads for this share, or the original src. */
function isAllowedImageSrc(src: string, token: string, original: ContentValue): boolean {
  if (/^\/s\/[\w-]+\/__pt\/uploads\/[0-9a-f-]{36}$/.test(src)) return src.startsWith(`/s/${token}/`);
  return "src" in original && original.src === src;
}

export function injectOverlay(html: string, config: { token: string; page: string; api: string }): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const snippet = `<script>window.__PT__=${json}</script><script src="/__pt/review.js" defer></script>`;
  const idx = html.toLowerCase().lastIndexOf("</body>");
  return idx === -1 ? html + snippet : html.slice(0, idx) + snippet + html.slice(idx);
}
