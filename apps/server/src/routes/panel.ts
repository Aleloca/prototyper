import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { SAFE_HEADERS, httpError, hostOf, type Ctx } from "../context.js";
import type { SessionRow, UserRow } from "../db.js";
import { PASSWORD_MIN, hashPassword, newTotpSecret, otpauthUrl, randomToken, sha256, verifyPassword, verifyTotp } from "../security.js";

export const SESSION_COOKIE = "pt_session";
const SESSION_DAYS = 30;
const MFA_MINUTES = 10;
const INVITE_DAYS = 7;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
    session?: SessionRow;
  }
}

const addDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const addMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const Password = z.string().min(PASSWORD_MIN, `The password must be at least ${PASSWORD_MIN} characters.`).max(200);
const Code = z.string().trim().min(6).max(10);

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function userDto(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, totpEnabled: !!u.totp_enabled, disabled: !!u.disabled };
}

/** Panel API (`/api/panel/*`) on the panel host: cookie sessions, then workspaces, projects and admin. */
export async function panelRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { store } = ctx;

  // Failed logins and 2FA codes, per email / session, kept in memory.
  const failures = new Map<string, { count: number; until: number }>();
  const locked = (k: string) => (failures.get(k)?.until ?? 0) > Date.now();
  const fail = (k: string) => {
    const f = failures.get(k) ?? { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILURES) {
      f.until = Date.now() + LOCK_MINUTES * 60_000;
      f.count = 0;
    }
    failures.set(k, f);
  };

  const setSessionCookie = (reply: FastifyReply, id: string, days: number) =>
    reply.header("Set-Cookie", `${SESSION_COOKIE}=${id}; Path=/; HttpOnly;${ctx.config.devPort ? "" : " Secure;"} SameSite=Lax; Max-Age=${Math.round(days * 86_400)}`);
  const clearSessionCookie = (reply: FastifyReply) => reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

  const newSession = (reply: FastifyReply, req: FastifyRequest, user: UserRow, stage: "mfa" | "full") => {
    const id = randomToken();
    const expires = stage === "full" ? addDays(SESSION_DAYS) : addMinutes(MFA_MINUTES);
    store.createSession({ id_hash: sha256(id), user_id: user.id, stage, created_at: new Date().toISOString(), expires_at: expires, user_agent: (req.headers["user-agent"] ?? "").slice(0, 300) });
    setSessionCookie(reply, id, stage === "full" ? SESSION_DAYS : MFA_MINUTES / 1440);
    return id;
  };

  /** Load the session (any stage) from the cookie. */
  const loadSession = (req: FastifyRequest): { session: SessionRow; user: UserRow } | undefined => {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!id) return undefined;
    const session = store.session(sha256(id));
    const user = session && store.user(session.user_id);
    if (!session || !user || user.disabled) return undefined;
    return { session, user };
  };

  /** Exported for the OAuth pages, which share the panel session. */
  app.decorate("panelSession", loadSession);

  await app.register(async (api) => {
    await api.register(rateLimit, { max: 300, timeWindow: "1 minute" });

    // Panel API only on the panel host; state-changing requests must come from the panel itself.
    api.addHook("onRequest", async (req, reply) => {
      if (hostOf(req) !== ctx.config.panelHost) return reply.code(404).send({ error: "not_found" });
      reply.headers({ ...SAFE_HEADERS, "Cache-Control": "no-store" });
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.origin;
        const site = req.headers["sec-fetch-site"];
        const sameOrigin = origin ? origin === ctx.panelOrigin : site === "same-origin";
        if (!sameOrigin) return reply.code(403).send({ error: "bad_origin" });
      }
    });

    const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
      const s = loadSession(req);
      if (!s || s.session.stage !== "full") return reply.code(401).send({ error: "unauthorized" });
      req.user = s.user;
      req.session = s.session;
      // Sliding expiry: extend when less than half the lifetime is left.
      if (Date.parse(s.session.expires_at) - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
        store.updateSession(s.session.id_hash, { expires_at: addDays(SESSION_DAYS) });
      }
    };
    const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
      await requireUser(req, reply);
      if (reply.sent) return;
      if (!req.user?.is_admin) return reply.code(403).send({ error: "forbidden" });
    };
    const me = (req: FastifyRequest) => req.user!;

    // --- sign in -----------------------------------------------------------------------------

    api.post("/api/panel/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const body = z.object({ email: z.string().trim().max(200), password: z.string().max(200) }).parse(req.body);
      const key = `login:${body.email.toLowerCase()}`;
      if (locked(key)) return reply.code(429).send({ error: "Too many attempts. Try again in a few minutes." });
      const user = store.userByEmail(body.email);
      const ok = await verifyPassword(body.password, user?.password_hash ?? null);
      if (!user || !ok || user.disabled) {
        fail(key);
        store.audit(user?.id ?? null, "login.failed", { email: body.email.toLowerCase() }, req.ip);
        return reply.code(401).send({ error: "Wrong email or password." });
      }
      failures.delete(key);
      if (user.totp_enabled) {
        newSession(reply, req, user, "mfa");
        return { mfaRequired: true };
      }
      newSession(reply, req, user, "full");
      store.updateUser(user.id, { last_login_at: new Date().toISOString() });
      store.audit(user.id, "login", {}, req.ip);
      return { user: userDto(user) };
    });

    api.post("/api/panel/login/mfa", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const s = loadSession(req);
      if (!s || s.session.stage !== "mfa") return reply.code(401).send({ error: "Sign in again." });
      const { code } = z.object({ code: Code }).parse(req.body);
      const key = `mfa:${s.user.id}`;
      if (locked(key)) return reply.code(429).send({ error: "Too many attempts. Try again in a few minutes." });
      const step = s.user.totp_secret ? verifyTotp(ctx.box.open(s.user.totp_secret), code, s.user.totp_last_step) : undefined;
      if (step === undefined) {
        fail(key);
        store.audit(s.user.id, "login.mfa_failed", {}, req.ip);
        return reply.code(401).send({ error: "Wrong code." });
      }
      failures.delete(key);
      store.updateUser(s.user.id, { totp_last_step: step, last_login_at: new Date().toISOString() });
      // New session id once fully signed in.
      store.deleteSession(s.session.id_hash);
      newSession(reply, req, s.user, "full");
      store.audit(s.user.id, "login", { mfa: true }, req.ip);
      return { user: userDto(store.user(s.user.id)!) };
    });

    api.post("/api/panel/logout", async (req, reply) => {
      const s = loadSession(req);
      if (s) store.deleteSession(s.session.id_hash);
      clearSessionCookie(reply);
      return { ok: true };
    });

    // --- invites (also used for password resets) ---------------------------------------------

    api.get("/api/panel/invites/:token", async (req, reply) => {
      const { token } = req.params as { token: string };
      const invite = store.invite(sha256(token));
      const user = invite && store.user(invite.user_id);
      if (!user || user.disabled) return reply.code(404).send({ error: "This invite is not valid any more. Ask for a new one." });
      return { email: user.email, name: user.name, reset: !!user.password_hash };
    });

    api.post("/api/panel/invites/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const { token } = req.params as { token: string };
      const body = z.object({ name: z.string().trim().min(1).max(100), password: Password }).parse(req.body);
      const invite = store.invite(sha256(token));
      const user = invite && store.user(invite.user_id);
      if (!user || user.disabled) return reply.code(404).send({ error: "This invite is not valid any more. Ask for a new one." });
      const hash = await hashPassword(body.password);
      store.transaction(() => {
        store.useInvite(invite!.token_hash);
        store.updateUser(user.id, { name: body.name, password_hash: hash });
      });
      store.deleteSessionsOf(user.id);
      store.audit(user.id, "invite.accept", {}, req.ip);
      return { ok: true, email: user.email };
    });

    // --- account -----------------------------------------------------------------------------

    api.get("/api/panel/me", { preHandler: requireUser }, async (req) => {
      const user = me(req);
      return {
        user: userDto(user),
        workspaces: store.workspacesOf(user).map((w) => ({ id: w.id, name: w.name })),
      };
    });

    api.put("/api/panel/me", { preHandler: requireUser }, async (req) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
      return { user: userDto(store.updateUser(me(req).id, { name })) };
    });

    api.put("/api/panel/me/password", { preHandler: requireUser }, async (req, reply) => {
      const body = z.object({ current: z.string().max(200), password: Password }).parse(req.body);
      const user = me(req);
      if (!(await verifyPassword(body.current, user.password_hash))) return reply.code(400).send({ error: "The current password is wrong." });
      store.updateUser(user.id, { password_hash: await hashPassword(body.password) });
      store.deleteSessionsOf(user.id, req.session!.id_hash);
      store.audit(user.id, "password.change", {}, req.ip);
      return { ok: true };
    });

    /** Start enabling 2FA: a new secret, shown once as a QR code; confirmed by /enable. */
    api.post("/api/panel/me/2fa/setup", { preHandler: requireUser }, async (req, reply) => {
      const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
      const user = me(req);
      if (user.totp_enabled) return reply.code(409).send({ error: "Two-factor authentication is already on." });
      if (!(await verifyPassword(password, user.password_hash))) return reply.code(400).send({ error: "Wrong password." });
      const secret = newTotpSecret();
      store.updateUser(user.id, { totp_secret: ctx.box.seal(secret), totp_last_step: 0 });
      return { secret, otpauthUrl: otpauthUrl(secret, user.email, `Prototyper (${ctx.config.panelHost})`) };
    });

    api.post("/api/panel/me/2fa/enable", { preHandler: requireUser }, async (req, reply) => {
      const { code } = z.object({ code: Code }).parse(req.body);
      const user = me(req);
      if (user.totp_enabled || !user.totp_secret) return reply.code(409).send({ error: "Start the setup first." });
      const step = verifyTotp(ctx.box.open(user.totp_secret), code, user.totp_last_step);
      if (step === undefined) return reply.code(400).send({ error: "Wrong code. Check the time on your phone and try again." });
      store.updateUser(user.id, { totp_enabled: 1, totp_last_step: step });
      store.audit(user.id, "2fa.enable", {}, req.ip);
      return { user: userDto(store.user(user.id)!) };
    });

    api.post("/api/panel/me/2fa/disable", { preHandler: requireUser }, async (req, reply) => {
      const body = z.object({ password: z.string().max(200), code: Code }).parse(req.body);
      const user = me(req);
      if (!user.totp_enabled || !user.totp_secret) return reply.code(409).send({ error: "Two-factor authentication is off." });
      if (!(await verifyPassword(body.password, user.password_hash))) return reply.code(400).send({ error: "Wrong password." });
      if (verifyTotp(ctx.box.open(user.totp_secret), body.code, user.totp_last_step) === undefined) return reply.code(400).send({ error: "Wrong code." });
      store.updateUser(user.id, { totp_enabled: 0, totp_secret: null, totp_last_step: 0 });
      // The MCP requires 2FA: its tokens go with it.
      store.revokeApiTokensOf(user.id);
      store.audit(user.id, "2fa.disable", {}, req.ip);
      return { user: userDto(store.user(user.id)!) };
    });

    api.get("/api/panel/me/tokens", { preHandler: requireUser }, async (req) =>
      store.apiTokens(me(req).id).map((t) => ({ id: t.id, name: t.name, createdAt: t.created_at, lastUsedAt: t.last_used_at, expiresAt: t.expires_at })),
    );

    api.delete("/api/panel/me/tokens/:id", { preHandler: requireUser }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!store.revokeApiToken(id, me(req).id)) return reply.code(404).send({ error: "unknown_token" });
      store.audit(me(req).id, "token.revoke", { token: id }, req.ip);
      return { ok: true };
    });

    // --- workspaces & projects ---------------------------------------------------------------

    api.get("/api/panel/workspaces/:id", { preHandler: requireUser }, async (req) => {
      const { id } = req.params as { id: string };
      const w = ctx.workspaceFor(me(req), id);
      return {
        workspace: { id: w.id, name: w.name },
        clients: store.clients(w.id).map((c) => ({ id: c.id, name: c.name, swatch: c.swatch })),
        projects: store.projects(w.id).map((p) => ctx.projectSummary(p)),
        domains: store.domains(w.id).map((d) => ({ id: d.id, hostname: d.hostname, status: d.status })),
        members: store.members(w.id).map((u) => ({ id: u.id, name: u.name, email: u.email })),
      };
    });

    api.get("/api/panel/projects/:id", { preHandler: requireUser }, async (req) => {
      const { id } = req.params as { id: string };
      return ctx.projectDetail(ctx.projectFor(me(req), id));
    });

    api.patch("/api/panel/projects/:id", { preHandler: requireUser }, async (req) => {
      const { id } = req.params as { id: string };
      const body = z.object({ name: z.string().trim().min(1).max(200).optional(), client: z.string().trim().min(1).max(200).optional(), domainId: z.string().optional() }).parse(req.body);
      const p = ctx.projectFor(me(req), id);
      const patch: { name?: string; client_id?: string; domain_id?: string | null } = {};
      if (body.name) patch.name = body.name;
      if (body.client) patch.client_id = store.ensureClient(randomUUID(), p.workspace_id, body.client).id;
      if (body.domainId) patch.domain_id = ctx.pickDomain(p.workspace_id, body.domainId);
      const updated = store.updateProject(p.id, patch);
      if (patch.client_id && patch.client_id !== p.client_id) store.deleteClientIfEmpty(p.client_id);
      return ctx.projectSummary(updated);
    });

    api.patch("/api/panel/projects/:id/share", { preHandler: requireUser }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { status } = z.object({ status: z.enum(["open", "readonly", "revoked"]) }).parse(req.body);
      const p = ctx.projectFor(me(req), id);
      const share = store.shareForProject(p.id);
      if (!share) return reply.code(409).send({ error: "Not published yet." });
      store.updateShare(share.token, { status });
      store.audit(me(req).id, "share.status", { project: p.id, status }, req.ip);
      return ctx.projectSummary(p);
    });

    /** A new link for the same project: the old one stops working. */
    api.post("/api/panel/projects/:id/share/regenerate", { preHandler: requireUser }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const p = ctx.projectFor(me(req), id);
      const share = store.shareForProject(p.id);
      if (!share) return reply.code(409).send({ error: "Not published yet." });
      store.updateShare(share.token, { token: randomToken() });
      store.audit(me(req).id, "share.regenerate", { project: p.id }, req.ip);
      return ctx.projectSummary(p);
    });

    api.delete("/api/panel/projects/:id", { preHandler: requireUser }, async (req) => {
      const { id } = req.params as { id: string };
      await ctx.deleteProject(me(req), ctx.projectFor(me(req), id));
      return { ok: true };
    });

    api.get("/api/panel/rounds/:id", { preHandler: requireUser }, async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      return ctx.feedback(ctx.roundFor(me(req), id), (u) => `/api/panel/uploads/${u}`);
    });

    api.get("/api/panel/uploads/:id", { preHandler: requireUser }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const u = z.string().uuid().safeParse(id).success ? store.upload(id) : undefined;
      if (!u) return reply.code(404).send({ error: "unknown_upload" });
      ctx.roundFor(me(req), u.round_id);
      return reply.header("Cache-Control", "private, max-age=86400").type(u.mime).send(createReadStream(u.file));
    });

    // --- admin -------------------------------------------------------------------------------

    /** Certificates are managed by the server when configured; otherwise TLS is someone else's job. */
    const activate = (domainId: string) => {
      if (app.domains) app.domains.activate(domainId);
      else store.updateDomain(domainId, { status: "active", last_error: null });
    };

    const inviteUrl = (userId: string) => {
      const token = randomToken();
      store.createInvite(sha256(token), userId, addDays(INVITE_DAYS));
      return `${ctx.panelOrigin}/invite/${token}`;
    };

    api.get("/api/panel/admin/users", { preHandler: requireAdmin }, async () =>
      store.users().map((u) => ({
        ...userDto(u),
        workspaceIds: store.memberships(u.id),
        invitePending: !u.password_hash && !!store.pendingInvite(u.id),
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
      })),
    );

    api.post("/api/panel/admin/users", { preHandler: requireAdmin }, async (req, reply) => {
      const body = z
        .object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(100).default(""), isAdmin: z.boolean().default(false), workspaceIds: z.array(z.string()).default([]) })
        .parse(req.body);
      if (store.userByEmail(body.email)) return reply.code(409).send({ error: "A user with this email already exists." });
      for (const w of body.workspaceIds) if (!store.workspace(w)) return reply.code(400).send({ error: "unknown_workspace" });
      const user = store.transaction(() => {
        const u = store.createUser({ id: randomUUID(), email: body.email, name: body.name, isAdmin: body.isAdmin });
        for (const w of body.workspaceIds) store.addMember(w, u.id);
        return u;
      });
      store.audit(me(req).id, "user.create", { user: user.id, email: user.email }, req.ip);
      return { user: userDto(user), inviteUrl: inviteUrl(user.id) };
    });

    api.patch("/api/panel/admin/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ name: z.string().trim().max(100).optional(), isAdmin: z.boolean().optional(), disabled: z.boolean().optional() }).parse(req.body);
      const user = store.user(id);
      if (!user) return reply.code(404).send({ error: "unknown_user" });
      if (id === me(req).id && (body.isAdmin === false || body.disabled === true)) return reply.code(400).send({ error: "You can't remove your own admin rights or disable yourself." });
      const updated = store.updateUser(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.isAdmin !== undefined ? { is_admin: body.isAdmin ? 1 : 0 } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled ? 1 : 0 } : {}),
      });
      if (body.disabled) {
        store.deleteSessionsOf(id);
        store.revokeApiTokensOf(id);
      }
      store.audit(me(req).id, "user.update", { user: id, ...body }, req.ip);
      return userDto(updated);
    });

    /** A new invite link, to set (or reset) the password. */
    api.post("/api/panel/admin/users/:id/invite", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!store.user(id)) return reply.code(404).send({ error: "unknown_user" });
      store.audit(me(req).id, "user.invite", { user: id }, req.ip);
      return { inviteUrl: inviteUrl(id) };
    });

    api.post("/api/panel/admin/users/:id/reset-2fa", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!store.user(id)) return reply.code(404).send({ error: "unknown_user" });
      store.updateUser(id, { totp_enabled: 0, totp_secret: null, totp_last_step: 0 });
      store.revokeApiTokensOf(id);
      store.deleteSessionsOf(id);
      store.audit(me(req).id, "user.reset_2fa", { user: id }, req.ip);
      return { ok: true };
    });

    api.get("/api/panel/admin/workspaces", { preHandler: requireAdmin }, async () =>
      store.workspaces().map((w) => ({
        id: w.id,
        name: w.name,
        memberIds: store.members(w.id).map((u) => u.id),
        domains: store.domains(w.id).map((d) => ({ id: d.id, hostname: d.hostname, status: d.status })),
        projects: store.projects(w.id).length,
      })),
    );

    api.post("/api/panel/admin/workspaces", { preHandler: requireAdmin }, async (req) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
      const w = store.createWorkspace(randomUUID(), name);
      store.audit(me(req).id, "workspace.create", { workspace: w.id, name }, req.ip);
      return { id: w.id, name: w.name };
    });

    api.patch("/api/panel/admin/workspaces/:id", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
      if (!store.workspace(id)) return reply.code(404).send({ error: "unknown_workspace" });
      const w = store.renameWorkspace(id, name);
      return { id: w.id, name: w.name };
    });

    api.delete("/api/panel/admin/workspaces/:id", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!store.workspace(id)) return reply.code(404).send({ error: "unknown_workspace" });
      if (store.projects(id).length) return reply.code(409).send({ error: "Delete or move its projects first." });
      store.deleteWorkspace(id);
      store.audit(me(req).id, "workspace.delete", { workspace: id }, req.ip);
      return { ok: true };
    });

    api.put("/api/panel/admin/workspaces/:id/members/:userId", { preHandler: requireAdmin }, async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      if (!store.workspace(id) || !store.user(userId)) return reply.code(404).send({ error: "not_found" });
      store.addMember(id, userId);
      store.audit(me(req).id, "member.add", { workspace: id, user: userId }, req.ip);
      return { ok: true };
    });

    api.delete("/api/panel/admin/workspaces/:id/members/:userId", { preHandler: requireAdmin }, async (req) => {
      const { id, userId } = req.params as { id: string; userId: string };
      store.removeMember(id, userId);
      store.audit(me(req).id, "member.remove", { workspace: id, user: userId }, req.ip);
      return { ok: true };
    });

    api.get("/api/panel/admin/domains", { preHandler: requireAdmin }, async () =>
      store.domains().map((d) => ({ id: d.id, workspaceId: d.workspace_id, hostname: d.hostname, status: d.status, certExpiresAt: d.cert_expires_at, lastError: d.last_error })),
    );

    api.post("/api/panel/admin/domains", { preHandler: requireAdmin }, async (req, reply) => {
      const body = z
        .object({
          workspaceId: z.string(),
          hostname: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Not a valid hostname."),
        })
        .parse(req.body);
      if (!store.workspace(body.workspaceId)) return reply.code(400).send({ error: "unknown_workspace" });
      if (body.hostname === ctx.config.panelHost) return reply.code(400).send({ error: "The panel host can't be a preview domain." });
      if (store.domainByHost(body.hostname)) return reply.code(409).send({ error: "This domain is already configured." });
      const d = store.createDomain(randomUUID(), body.workspaceId, body.hostname);
      store.audit(me(req).id, "domain.create", { domain: d.id, hostname: d.hostname }, req.ip);
      activate(d.id);
      return { id: d.id, hostname: d.hostname, status: store.domain(d.id)!.status };
    });

    api.patch("/api/panel/admin/domains/:id", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ workspaceId: z.string().optional(), disabled: z.boolean().optional() }).parse(req.body);
      const d = store.domain(id);
      if (!d) return reply.code(404).send({ error: "unknown_domain" });
      if (body.workspaceId) {
        if (!store.workspace(body.workspaceId)) return reply.code(400).send({ error: "unknown_workspace" });
        if (store.one("SELECT 1 AS x FROM projects WHERE domain_id = ?", id)) return reply.code(409).send({ error: "Projects use this domain: move them first." });
        store.updateDomain(id, { workspace_id: body.workspaceId });
      }
      if (body.disabled === true) store.updateDomain(id, { status: "disabled" });
      if (body.disabled === false) activate(id);
      store.audit(me(req).id, "domain.update", { domain: id, ...body }, req.ip);
      const u = store.domain(id)!;
      return { id: u.id, hostname: u.hostname, status: u.status };
    });

    /** Retry the DNS check and the certificate. */
    api.post("/api/panel/admin/domains/:id/verify", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!store.domain(id)) return reply.code(404).send({ error: "unknown_domain" });
      activate(id);
      return { ok: true };
    });

    api.delete("/api/panel/admin/domains/:id", { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const d = store.domain(id);
      if (!d) return reply.code(404).send({ error: "unknown_domain" });
      if (store.one("SELECT 1 AS x FROM projects WHERE domain_id = ?", id)) return reply.code(409).send({ error: "Projects use this domain: move them first." });
      store.deleteDomain(id);
      store.audit(me(req).id, "domain.delete", { hostname: d.hostname }, req.ip);
      return { ok: true };
    });
  });
}

declare module "fastify" {
  interface FastifyInstance {
    panelSession: (req: FastifyRequest) => { session: SessionRow; user: UserRow } | undefined;
    /** Certificate manager for preview domains (milestone 3); absent in tests. */
    domains?: { activate: (domainId: string) => void };
  }
}

export { httpError };
