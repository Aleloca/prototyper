import { createReadStream } from "node:fs";
import * as tar from "tar";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { SAFE_HEADERS, hostOf, type Ctx } from "../context.js";
import { sha256 } from "../security.js";
import { userDto } from "./panel.js";
import type { Store, UserRow } from "../db.js";

/** The user behind an MCP token. Tokens are only valid while the user is active and keeps 2FA on. */
export function apiUser(store: Store, token: string): UserRow | undefined {
  const row = token ? store.apiTokenByHash(sha256(token)) : undefined;
  const user = row && store.user(row.user_id);
  if (!row || !user || user.disabled || !user.totp_enabled) return undefined;
  store.touchApiToken(row.id);
  return user;
}

/** API for the MCP (`/api/v1/*`) on the panel host: bearer tokens issued after a 2FA login. */
export async function apiRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { store } = ctx;

  await app.register(async (api) => {
    await api.register(rateLimit, { max: 300, timeWindow: "1 minute" });

    api.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (hostOf(req) !== ctx.config.panelHost) return reply.code(404).send({ error: "not_found" });
      reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" });
      const header = req.headers.authorization ?? "";
      const user = apiUser(store, header.startsWith("Bearer ") ? header.slice(7).trim() : "");
      if (!user) return reply.code(401).send({ error: "unauthorized", hint: "Run the prototyper login tool again." });
      req.user = user;
    });

    const me = (req: FastifyRequest) => req.user!;

    api.get("/api/v1/me", async (req) => {
      const user = me(req);
      return {
        user: userDto(user),
        workspaces: store.workspacesOf(user).map((w) => ({
          id: w.id,
          name: w.name,
          domains: store.domains(w.id).filter((d) => d.status === "active").map((d) => ({ id: d.id, hostname: d.hostname })),
          clients: store.clients(w.id).map((c) => c.name),
        })),
      };
    });

    api.get("/api/v1/projects", async (req) => {
      const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query);
      const workspaces = workspaceId ? [ctx.workspaceFor(me(req), workspaceId)] : store.workspacesOf(me(req));
      return workspaces.flatMap((w) => store.projects(w.id).map((p) => ctx.projectSummary(p)));
    });

    api.post("/api/v1/projects", async (req) => {
      const body = z
        .object({ workspaceId: z.string(), client: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200), domain: z.string().optional() })
        .parse(req.body);
      const p = ctx.createProject(me(req), { workspaceId: body.workspaceId, client: body.client, name: body.name, domainId: body.domain });
      store.audit(me(req).id, "project.create", { project: p.id, name: p.name });
      return ctx.projectSummary(p);
    });

    api.get("/api/v1/projects/:id", async (req) => {
      const { id } = req.params as { id: string };
      return ctx.projectDetail(ctx.projectFor(me(req), id));
    });

    api.patch("/api/v1/projects/:id", async (req) => {
      const { id } = req.params as { id: string };
      const body = z.object({ name: z.string().trim().min(1).max(200).optional(), domain: z.string().optional() }).parse(req.body);
      const p = ctx.projectFor(me(req), id);
      return ctx.projectSummary(
        store.updateProject(p.id, {
          ...(body.name ? { name: body.name } : {}),
          ...(body.domain ? { domain_id: ctx.pickDomain(p.workspace_id, body.domain) } : {}),
        }),
      );
    });

    /** Body: tar.gz of the built site (index.html at the root). */
    api.post("/api/v1/projects/:id/versions", async (req, reply) => {
      const { id } = req.params as { id: string };
      const { changelog, commit } = z
        .object({ changelog: z.string().max(20_000).default(""), commit: z.string().regex(/^[0-9a-f]{40}$/).optional() })
        .parse(req.query);
      const p = ctx.projectFor(me(req), id);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: "expected a tar.gz body" });
      return ctx.publishVersion(me(req), p, req.body, changelog, commit);
    });

    /** Where the project's sources live (internal git) and the commit `main` is at. */
    api.get("/api/v1/projects/:id/source", async (req) => {
      const { id } = req.params as { id: string };
      const p = ctx.projectFor(me(req), id);
      const git = ctx.git && (await ctx.git.available()) ? ctx.git : undefined;
      return { git: git ? `${ctx.panelOrigin}/git/${p.id}.git` : null, head: (await git?.head(p.id)) ?? null };
    });

    /** The built files of the latest version (tar.gz), for projects published before their sources were kept. */
    api.get("/api/v1/projects/:id/versions/latest/files", async (req, reply) => {
      const { id } = req.params as { id: string };
      const v = store.latestVersion(ctx.projectFor(me(req), id).id);
      if (!v) return reply.code(404).send({ error: "Not published yet." });
      return reply.type("application/gzip").send(tar.c({ gzip: true, cwd: v.dir, portable: true }, ["."]));
    });

    /** The current round (the one the client works in) plus a pointer to the last submitted one. */
    api.get("/api/v1/projects/:id/feedback", async (req, reply) => {
      const { id } = req.params as { id: string };
      const p = ctx.projectFor(me(req), id);
      const rounds = store.rounds(p.id);
      const round = rounds.at(-1);
      if (!round) return reply.code(409).send({ error: "Not published yet." });
      return ctx.feedback(round, (u) => `/api/v1/uploads/${u}`);
    });

    api.get("/api/v1/rounds/:id", async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      return ctx.feedback(ctx.roundFor(me(req), id), (u) => `/api/v1/uploads/${u}`);
    });

    api.post("/api/v1/rounds/:id/imported", async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      const { replies } = z
        .object({
          replies: z.record(z.string(), z.object({ status: z.enum(["resolved", "answered", "open"]), reply: z.string().max(5000).optional() })).default({}),
        })
        .parse(req.body ?? {});
      return ctx.importRound(me(req), ctx.roundFor(me(req), id), replies);
    });

    api.get("/api/v1/uploads/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const u = z.string().uuid().safeParse(id).success ? store.upload(id) : undefined;
      if (!u) return reply.code(404).send({ error: "unknown_upload" });
      ctx.roundFor(me(req), u.round_id);
      return reply.type(u.mime).send(createReadStream(u.file));
    });
  });
}
