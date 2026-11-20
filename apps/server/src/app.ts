import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { Ctx, type ServerConfig } from "./context.js";
import { Store } from "./db.js";
import { DomainManager } from "./domains.js";
import { Thumbnails } from "./thumbnails.js";
import { GitRepos } from "./git.js";
import { gitRoutes } from "./routes/git.js";
import { apiRoutes } from "./routes/api.js";
import { oauthRoutes } from "./routes/oauth.js";
import { panelRoutes } from "./routes/panel.js";
import { panelStatic } from "./routes/static.js";
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
    ...(config.https ? { https: config.https } : {}),
  } as FastifyServerOptions) as unknown as FastifyInstance;
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

  if (config.acme) {
    const domains = new DomainManager(ctx, { ...config.acme, log: app.log });
    app.decorate("domains", domains);
    domains.routes(app);
    app.addHook("onReady", async () => domains.start());
    app.addHook("onClose", async () => domains.stop());
  }

  if (config.thumbnails) {
    const thumbs = new Thumbnails(store, join(config.dataDir, "thumbs"), app.log);
    ctx.thumbnails = thumbs;
    app.addHook("onReady", async () => void thumbs.backfill());
    app.addHook("onClose", async () => thumbs.close());
  }

  if (config.git !== false) ctx.git = new GitRepos(join(config.dataDir, "git"), app.log);

  await panelRoutes(app, ctx);
  await gitRoutes(app, ctx);
  await oauthRoutes(app, ctx);
  await apiRoutes(app, ctx);
  await reviewRoutes(app, ctx);

  await panelStatic(app, ctx);

  return { app, store, ctx };
}
