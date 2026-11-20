import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { SAFE_HEADERS, hostOf, notFoundPage, type Ctx } from "../context.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/**
 * The panel SPA on the panel host: static assets, and index.html for every other GET (client-side
 * routes). Demos are framed from preview domains (https), never served here.
 */
export async function panelStatic(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const root = ctx.config.panelDir;
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https:${ctx.config.devPort ? " http:" : ""}`,
    `frame-src https:${ctx.config.devPort ? " http:" : ""}`,
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
  const headers = { ...SAFE_HEADERS, "Content-Security-Policy": CSP, "X-Frame-Options": "DENY", "Strict-Transport-Security": "max-age=31536000" };

  let indexHtml: string | undefined;
  const index = async () => (indexHtml ??= root ? await readFile(join(root, "index.html"), "utf8").catch(() => "") : "");

  app.get("/*", async (req, reply) => {
    if (hostOf(req) !== ctx.config.panelHost) return notFoundPage(reply);
    const path = decodeURIComponent((req.params as { "*": string })["*"] ?? "");
    if (path.startsWith("api/")) return reply.code(404).send({ error: "not_found" });
    if (root && path && extname(path)) {
      const file = normalize(join(root, path));
      if (file.startsWith(root + sep) && (await stat(file).catch(() => undefined))?.isFile()) {
        const immutable = path.startsWith("assets/");
        return reply
          .headers({ ...headers, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300" })
          .type(TYPES[extname(file)] ?? "application/octet-stream")
          .send(createReadStream(file));
      }
      return reply.code(404).headers(headers).send({ error: "not_found" });
    }
    const html = await index();
    if (!html) return reply.headers(headers).type("text/plain").send("Prototyper: the panel is not built (pnpm --filter @prototyper/panel build).");
    return reply.headers({ ...headers, "Cache-Control": "no-cache" }).type("text/html; charset=utf-8").send(html);
  });
}
