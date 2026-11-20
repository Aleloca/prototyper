import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { Ctx, SAFE_HEADERS, hostOf, notFoundPage, type ServerConfig } from "./context.js";
import { Store } from "./db.js";
import { apiRoutes } from "./routes/api.js";
import { panelRoutes } from "./routes/panel.js";
import { reviewRoutes } from "./routes/review.js";

export type { ServerConfig } from "./context.js";
export { injectOverlay } from "./routes/review.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function buildApp(config: ServerConfig): Promise<{ app: FastifyInstance; store: Store; ctx: Ctx }> {
  await mkdir(join(config.dataDir, "projects"), { recursive: true });
  await mkdir(join(config.dataDir, "uploads"), { recursive: true });
  const store = new Store(join(config.dataDir, "prototyper.db"));
  const ctx = new Ctx(store, { ...config, panelHost: config.panelHost.toLowerCase() });

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

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first?.message ?? "invalid_request", details: err.issues });
    }
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: code >= 500 ? "internal_error" : err.message });
  });

  await panelRoutes(app, ctx);
  await apiRoutes(app, ctx);
  await reviewRoutes(app, ctx);

  app.get("/", async (req, reply) => {
    if (hostOf(req) !== ctx.config.panelHost) return notFoundPage(reply);
    return reply.headers(SAFE_HEADERS).type("text/plain").send("Prototyper");
  });

  return { app, store, ctx };
}
