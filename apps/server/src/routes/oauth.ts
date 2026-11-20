import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { SAFE_HEADERS, hostOf, type Ctx } from "../context.js";
import { pkceChallenge, randomToken, safeEqual, sha256, verifyTotp } from "../security.js";

const CODE_SECONDS = 60;
const TOKEN_DAYS = 90;

/** Only loopback redirects: the MCP listens on 127.0.0.1 for the browser to come back. */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]") && !!u.port && u.pathname === "/callback" && !u.username && !u.password;
  } catch {
    return false;
  }
}

const AuthorizeBody = z.object({
  redirectUri: z.string().max(200),
  codeChallenge: z.string().regex(/^[\w-]{43}$/, "invalid code_challenge"),
  state: z.string().max(200),
  clientName: z.string().trim().min(1).max(100),
  code: z.string().trim().min(6).max(10),
});

/**
 * MCP login: authorization code + PKCE with a loopback redirect (RFC 8252). The consent page is the
 * panel's /oauth/authorize; approving it needs the panel session, 2FA on, and a fresh TOTP code.
 */
export async function oauthRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { store } = ctx;

  await app.register(async (r) => {
    await r.register(rateLimit, { max: 20, timeWindow: "1 minute" });
    r.addHook("onRequest", async (req, reply) => {
      if (hostOf(req) !== ctx.config.panelHost) return reply.code(404).send({ error: "not_found" });
      reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" });
    });

    /** Called by the consent page (same-origin, signed in). Returns where to send the browser. */
    r.post("/api/panel/oauth/authorize", async (req, reply) => {
      if (req.headers.origin !== ctx.panelOrigin) return reply.code(403).send({ error: "bad_origin" });
      const s = app.panelSession(req);
      if (!s || s.session.stage !== "full") return reply.code(401).send({ error: "unauthorized" });
      const body = AuthorizeBody.parse(req.body);
      if (!isLoopbackRedirect(body.redirectUri)) return reply.code(400).send({ error: "Invalid redirect address." });
      const user = store.user(s.user.id)!;
      if (!user.totp_enabled || !user.totp_secret) return reply.code(403).send({ error: "Turn on two-factor authentication first." });
      const step = verifyTotp(ctx.box.open(user.totp_secret), body.code, user.totp_last_step);
      if (step === undefined) {
        store.audit(user.id, "oauth.mfa_failed", {}, req.ip);
        return reply.code(400).send({ error: "Wrong code." });
      }
      store.updateUser(user.id, { totp_last_step: step });
      const code = randomToken();
      store.createOAuthCode({
        code_hash: sha256(code),
        user_id: user.id,
        code_challenge: body.codeChallenge,
        redirect_uri: body.redirectUri,
        client_name: body.clientName,
        expires_at: new Date(Date.now() + CODE_SECONDS * 1000).toISOString(),
      });
      store.audit(user.id, "oauth.authorize", { client: body.clientName }, req.ip);
      const target = new URL(body.redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", body.state);
      return { redirect: target.toString() };
    });

    /** Called by the MCP (no browser): exchange the code for an API token. */
    r.post("/oauth/token", async (req, reply) => {
      const body = z
        .object({ grant_type: z.literal("authorization_code"), code: z.string().max(200), code_verifier: z.string().min(43).max(128), redirect_uri: z.string().max(200) })
        .parse(req.body);
      const row = store.consumeOAuthCode(sha256(body.code));
      if (!row || row.redirect_uri !== body.redirect_uri || !safeEqual(pkceChallenge(body.code_verifier), row.code_challenge)) {
        return reply.code(400).send({ error: "invalid_grant" });
      }
      const user = store.user(row.user_id);
      if (!user || user.disabled || !user.totp_enabled) return reply.code(400).send({ error: "invalid_grant" });
      const token = `pt_${randomToken()}`;
      const expires = new Date(Date.now() + TOKEN_DAYS * 86_400_000);
      store.createApiToken({ id: randomUUID(), user_id: user.id, name: row.client_name, token_hash: sha256(token), expires_at: expires.toISOString() });
      store.audit(user.id, "token.issue", { client: row.client_name }, req.ip);
      return { access_token: token, token_type: "Bearer", expires_in: TOKEN_DAYS * 86_400, user: { email: user.email, name: user.name } };
    });
  });
}
