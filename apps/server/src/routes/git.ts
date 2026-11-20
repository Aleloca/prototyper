import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { hostOf, type Ctx } from "../context.js";
import { GitRepos } from "../git.js";
import { apiUser } from "./api.js";

/**
 * Project sources over git's smart HTTP protocol, on the panel host: `/git/<projectId>.git`.
 * Authenticated with the MCP token, as `Authorization: Bearer <token>` (what the MCP sends) or as
 * the password of HTTP basic auth (for plain `git clone`), with any user name.
 */
export async function gitRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const git = ctx.git;
  if (!git) return;
  await app.register(async (r) => {
    await r.register(rateLimit, { max: 120, timeWindow: "1 minute" });
    // Pack data is streamed to git as it arrives, never buffered.
    r.addContentTypeParser(["application/x-git-upload-pack-request", "application/x-git-receive-pack-request"], (_req, payload, done) => done(null, payload));

    r.route({
      method: ["GET", "POST"],
      url: "/git/:repo/*",
      handler: async (req, reply) => {
        if (hostOf(req) !== ctx.config.panelHost) return reply.code(404).send({ error: "not_found" });
        const { repo, "*": rest } = req.params as { repo: string; "*": string };
        const projectId = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
        const service = GitRepos.service(rest, req.query as Record<string, string | undefined>, req.method);
        if (!service) return reply.code(404).send({ error: "not_found" });

        const header = req.headers.authorization ?? "";
        let token = "";
        if (header.startsWith("Bearer ")) token = header.slice(7).trim();
        else if (header.startsWith("Basic ")) token = Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":");
        const user = apiUser(ctx.store, token);
        if (!user) {
          return reply.code(401).header("WWW-Authenticate", 'Basic realm="Prototyper", charset="UTF-8"').send("Sign in with your Prototyper token (the MCP login).\n");
        }
        const project = ctx.projectFor(user, projectId);
        if (!(await git.available())) return reply.code(503).send({ error: "git_unavailable" });
        if (service === "git-receive-pack" && req.method === "POST") ctx.store.audit(user.id, "source.push", { project: project.id });
        await git.serve(req, reply, project.id, rest, user.email);
      },
    });
  });
}
