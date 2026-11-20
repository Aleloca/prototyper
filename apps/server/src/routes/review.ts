import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import sharp from "sharp";
import { z } from "zod";
import { ContentValue, KEY_PATTERN, applyEdits, sanitizeRich, type ContentEdit } from "@prototyper/shared";
import { SAFE_HEADERS, commentDto, hostOf, notFoundPage, type Ctx } from "../context.js";
import type { RoundRow, ShareRow, VersionRow } from "../db.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
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

const ACCEPTED_IMAGES = new Set(["jpeg", "png", "webp", "avif", "gif"]);
const MAX_IMAGE_SIDE = 2400;

const AuthorSchema = z.string().trim().min(1).max(80);
const AnchorSchema = z.object({
  key: z.string().max(200).optional(),
  selector: z.string().max(1000).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  viewportWidth: z.number().int().min(0).max(10000).optional(),
});

/** Review links (`/s/:token/`) and signed version previews (`/v/...`), served on preview domains only. */
export async function reviewRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { store } = ctx;

  /** Is this request on an active preview domain? Returns the domain id. */
  const previewDomain = (req: FastifyRequest): string | undefined => {
    const d = store.domainByHost(hostOf(req));
    return d && d.status === "active" ? d.id : undefined;
  };

  /** Resolve a share for a public request: unknown token, wrong host and revoked links all look the same. */
  const resolveShare = (req: FastifyRequest, token: string): { share: ShareRow; version: VersionRow; round: RoundRow } | undefined => {
    const domainId = previewDomain(req);
    const share = domainId ? store.share(token) : undefined;
    if (!share || share.status === "revoked") return undefined;
    const project = store.project(share.project_id);
    if (!project || project.domain_id !== domainId) return undefined;
    const version = store.version(share.version_id);
    const round = store.currentRound(share.project_id);
    if (!version || !round) return undefined;
    return { share, version, round };
  };

  /** Whether the client may still change things in this round. */
  const editable = (share: ShareRow, round: RoundRow) => share.status === "open" && round.status !== "imported";

  /** Serve a file of a version folder; HTML goes through `html` (edits, overlay). */
  async function serveFile(reply: FastifyReply, root: string, relPath: string, html?: (source: string, rel: string) => string | Promise<string>) {
    let rel = relPath;
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) return notFoundPage(reply);
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return notFoundPage(reply);
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    if (!type.startsWith("text/html") || !html) {
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "private, max-age=60" }).type(type).send(createReadStream(file));
    }
    const body = await html(await readFile(file, "utf8"), rel.split(sep).join("/"));
    return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" }).type(type).send(body);
  }

  app.get("/__pt/review.js", async (req, reply) => {
    if (!previewDomain(req)) return notFoundPage(reply);
    return reply.headers({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" }).send(ctx.config.overlayJs);
  });

  await app.register(async (pub) => {
    await pub.register(rateLimit, { max: 600, timeWindow: "1 minute" });

    pub.get("/s/:token", async (req, reply) => {
      const { token } = req.params as { token: string };
      if (!resolveShare(req, token)) return notFoundPage(reply);
      return reply.redirect(`/s/${token}/`);
    });

    pub.get("/s/:token/__pt/state", async (req, reply) => {
      const { token } = req.params as { token: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      const { share, version, round } = c;
      const content = await ctx.versionContent(version);
      const edits = store.edits(round.id);
      const previous = store.rounds(share.project_id).filter((r) => r.id < round.id && r.status === "imported").at(-1);
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" }).send({
        editable: editable(share, round),
        shareStatus: share.status,
        version: { number: version.number, changelog: version.changelog, publishedAt: version.published_at },
        round: ctx.roundDto(round),
        edits: edits.map((e) => ({ key: e.key, page: e.page, value: JSON.parse(e.value_json) as unknown, author: e.author, updatedAt: e.updated_at })),
        originals: Object.fromEntries(edits.map((e) => [e.key, content.get(e.key)?.value ?? null])),
        comments: store.comments(round.id).map(commentDto),
        previousComments: previous ? store.comments(previous.id).map(commentDto) : [],
      });
    });

    pub.put("/s/:token/__pt/edits/:key", async (req, reply) => {
      const { token, key } = req.params as { token: string; key: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      if (!KEY_PATTERN.test(key)) return reply.code(400).send({ error: "invalid_key" });
      const body = z.object({ value: ContentValue, page: z.string().max(500), author: AuthorSchema }).parse(req.body);

      const original = (await ctx.versionContent(c.version)).get(key);
      if (!original) return reply.code(404).send({ error: "unknown_key" });
      if (original.kind !== body.value.kind) return reply.code(400).send({ error: "kind_mismatch" });

      let value = body.value;
      if (value.kind === "rich") value = { kind: "rich", html: sanitizeRich(value.html) };
      if ((value.kind === "image" || value.kind === "bg") && !isAllowedImageSrc(value.src, token, original.value)) {
        return reply.code(400).send({ error: "invalid_image_src" });
      }
      store.putEdit(c.round.id, key, body.page, JSON.stringify(value), body.author);
      return { ok: true, value };
    });

    pub.delete("/s/:token/__pt/edits/:key", async (req, reply) => {
      const { token, key } = req.params as { token: string; key: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      const { author } = z.object({ author: AuthorSchema }).parse(req.query);
      store.deleteEdit(c.round.id, key, author);
      return { ok: true };
    });

    pub.post("/s/:token/__pt/uploads", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
      const { token } = req.params as { token: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });

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
      const path = join(ctx.config.dataDir, "uploads", `${id}.webp`);
      await writeFile(path, data);
      store.addUpload({ id, round_id: c.round.id, key, file: path, mime: "image/webp", width: info.width, height: info.height });
      return { id, src: `/s/${token}/__pt/uploads/${id}`, width: info.width, height: info.height };
    });

    pub.get("/s/:token/__pt/uploads/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const c = resolveShare(req, token);
      const u = c && z.string().uuid().safeParse(id).success ? store.upload(id) : undefined;
      // Uploads are only visible through the share of the project they belong to.
      if (!c || !u || store.round(u.round_id)?.project_id !== c.share.project_id) return notFoundPage(reply);
      return reply.headers({ ...SAFE_HEADERS, "Cache-Control": "private, max-age=86400" }).type(u.mime).send(createReadStream(u.file));
    });

    pub.post("/s/:token/__pt/comments", async (req, reply) => {
      const { token } = req.params as { token: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      const body = z.object({ page: z.string().max(500), anchor: AnchorSchema, text: z.string().trim().min(1).max(5000), author: AuthorSchema }).parse(req.body);
      const row = store.addComment({ id: randomUUID(), round_id: c.round.id, page: body.page, anchor_json: JSON.stringify(body.anchor), text: body.text, author: body.author });
      return commentDto(row);
    });

    pub.patch("/s/:token/__pt/comments/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      const row = store.comment(id);
      if (!row || row.round_id !== c.round.id) return reply.code(404).send({ error: "unknown_comment" });
      const { text } = z.object({ text: z.string().trim().min(1).max(5000) }).parse(req.body);
      return commentDto(store.updateComment(id, text));
    });

    pub.delete("/s/:token/__pt/comments/:id", async (req, reply) => {
      const { token, id } = req.params as { token: string; id: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      const row = store.comment(id);
      if (!row || row.round_id !== c.round.id) return reply.code(404).send({ error: "unknown_comment" });
      store.deleteComment(id);
      return { ok: true };
    });

    pub.post("/s/:token/__pt/submit", async (req, reply) => {
      const { token } = req.params as { token: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      if (!editable(c.share, c.round)) return reply.code(409).send({ error: "read_only" });
      const { author } = z.object({ author: AuthorSchema }).parse(req.body);
      return ctx.roundDto(store.submitRound(c.round.id, author));
    });

    /** The demo itself: current version files, with the round's edits applied and the overlay injected. */
    pub.get("/s/:token/*", async (req, reply) => {
      const { token } = req.params as { token: string };
      const c = resolveShare(req, token);
      if (!c) return notFoundPage(reply);
      const rel = decodeURIComponent((req.params as { "*": string })["*"] ?? "");
      return serveFile(reply, c.version.dir, rel, (source, page) => {
        const edits: ContentEdit[] = store.edits(c.round.id).map((e) => ({ key: e.key, value: JSON.parse(e.value_json) as ContentValue }));
        return injectOverlay(applyEdits(source, edits).html, { token, page, api: `/s/${token}/__pt` });
      });
    });

    /** A specific version as published, for the panel's previews: signed and expiring, no overlay. */
    pub.get("/v/:sig/*", async (req, reply) => {
      const { sig } = req.params as { sig: string };
      const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(sig);
      const domainId = previewDomain(req);
      if (!m || !domainId || !ctx.checkVersionSignature(Number(m[1]), Number(m[2]), m[3]!)) return notFoundPage(reply);
      const version = store.version(Number(m[1]));
      const project = version && store.project(version.project_id);
      if (!version || !project || project.domain_id !== domainId) return notFoundPage(reply);
      const rel = decodeURIComponent((req.params as { "*": string })["*"] ?? "");
      return serveFile(reply, version.dir, rel, (source) => source);
    });
  });
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
