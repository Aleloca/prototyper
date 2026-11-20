import { randomBytes } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as acme from "acme-client";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Ctx } from "./context.js";

export interface DomainManagerOptions {
  /** Where certificates are written: `<certsDir>/<hostname>/{fullchain,privkey}.pem` (read by nginx). */
  certsDir: string;
  /** Let's Encrypt staging instead of production (for testing the setup). */
  staging?: boolean;
  /** Contact email for the ACME account (optional). */
  email?: string;
  log: FastifyBaseLogger;
}

const RENEW_DAYS = 30;
const CHECK_EVERY_MS = 12 * 3600_000;

/**
 * Preview domains: DNS check, Let's Encrypt certificates over HTTP-01 (served by this app through
 * nginx's default server on port 80), renewals. One domain at a time.
 */
export class DomainManager {
  private readonly challenges = new Map<string, string>();
  private readonly queue: string[] = [];
  private working = false;
  private client: acme.Client | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly ctx: Ctx,
    private readonly opts: DomainManagerOptions,
  ) {}

  /** HTTP-01 answers, on every host. */
  routes(app: FastifyInstance): void {
    app.get("/.well-known/acme-challenge/:token", async (req, reply) => {
      const { token } = req.params as { token: string };
      const answer = this.challenges.get(token);
      if (!answer) return reply.code(404).type("text/plain").send("not found");
      return reply.type("text/plain").send(answer);
    });
  }

  start(): void {
    // Pick up domains left pending (e.g. after a restart) and renew what's due, panel included.
    for (const d of this.ctx.store.domains()) if (d.status === "pending") this.activate(d.id);
    void this.renewDue();
    this.timer = setInterval(() => void this.renewDue(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Queue a domain for DNS check + certificate. Marks it pending right away. */
  activate(domainId: string): void {
    const d = this.ctx.store.domain(domainId);
    if (!d) return;
    this.ctx.store.updateDomain(domainId, { status: "pending", last_error: null });
    if (!this.queue.includes(domainId)) this.queue.push(domainId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const d = this.ctx.store.domain(id);
        if (!d || d.status !== "pending") continue;
        try {
          await this.issue(d.hostname);
          const info = acme.crypto.readCertificateInfo(await readFile(join(this.opts.certsDir, d.hostname, "fullchain.pem")));
          this.ctx.store.updateDomain(id, { status: "active", cert_expires_at: info.notAfter.toISOString(), last_error: null });
          this.ctx.store.audit(null, "domain.certificate", { hostname: d.hostname, until: info.notAfter.toISOString() });
          this.opts.log.info({ hostname: d.hostname }, "certificate issued");
        } catch (e) {
          const message = (e as Error).message.slice(0, 500);
          // Still pending if it was disabled meanwhile? Keep the user's choice.
          if (this.ctx.store.domain(id)?.status === "pending") this.ctx.store.updateDomain(id, { status: "error", last_error: message });
          this.opts.log.warn({ hostname: d.hostname, err: message }, "certificate failed");
        }
      }
    } finally {
      this.working = false;
    }
  }

  /** Expiry of the certificate on disk for a hostname, if any. */
  private async certExpiry(hostname: string): Promise<number | undefined> {
    const pem = await readFile(join(this.opts.certsDir, hostname, "fullchain.pem")).catch(() => undefined);
    return pem ? acme.crypto.readCertificateInfo(pem).notAfter.getTime() : undefined;
  }

  /** Renew active certificates that expire within RENEW_DAYS (the panel's own included). */
  private async renewDue(): Promise<void> {
    const soon = Date.now() + RENEW_DAYS * 86_400_000;
    const panel = this.ctx.config.panelHost;
    if (((await this.certExpiry(panel)) ?? 0) < soon) {
      await this.issue(panel).then(
        () => this.opts.log.info({ hostname: panel }, "panel certificate issued"),
        (e: Error) => this.opts.log.error({ hostname: panel, err: e.message }, "panel certificate failed"),
      );
    }
    for (const d of this.ctx.store.domains()) {
      if (d.status !== "active") continue;
      if (d.cert_expires_at && Date.parse(d.cert_expires_at) > soon) continue;
      try {
        await this.issue(d.hostname);
        const info = acme.crypto.readCertificateInfo(await readFile(join(this.opts.certsDir, d.hostname, "fullchain.pem")));
        this.ctx.store.updateDomain(d.id, { cert_expires_at: info.notAfter.toISOString(), last_error: null });
        this.opts.log.info({ hostname: d.hostname }, "certificate renewed");
      } catch (e) {
        // The current certificate keeps working until it expires; show the problem in the panel.
        this.ctx.store.updateDomain(d.id, { last_error: `Renewal failed: ${(e as Error).message}`.slice(0, 500) });
        this.opts.log.warn({ hostname: d.hostname, err: (e as Error).message }, "renewal failed");
      }
    }
  }

  private async checkDns(hostname: string): Promise<void> {
    const server = await resolve4(this.ctx.config.panelHost).catch(() => [] as string[]);
    const domain = await resolve4(hostname).catch(() => [] as string[]);
    if (!domain.length) throw new Error(`${hostname} doesn't resolve yet. Check the DNS record (it can take a few minutes to propagate).`);
    if (server.length && !domain.some((ip) => server.includes(ip))) {
      throw new Error(`${hostname} points to ${domain.join(", ")}, but this server is ${server.join(", ")}. Fix the DNS record.`);
    }
  }

  /** Before asking Let's Encrypt, check that http://hostname/.well-known/... reaches this app. */
  private async checkReachable(hostname: string): Promise<void> {
    const token = `pt-probe-${randomBytes(12).toString("hex")}`;
    const value = randomBytes(12).toString("hex");
    this.challenges.set(token, value);
    try {
      const res = await fetch(`http://${hostname}/.well-known/acme-challenge/${token}`, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
      if ((await res.text()).trim() !== value) throw new Error("wrong answer");
    } catch (e) {
      throw new Error(`http://${hostname} doesn't reach Prototyper (${(e as Error).message}). Check the DNS and the nginx default server.`);
    } finally {
      this.challenges.delete(token);
    }
  }

  private async acmeClient(): Promise<acme.Client> {
    if (this.client) return this.client;
    const dir = join(this.ctx.config.dataDir, "acme");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, this.opts.staging ? "account-staging.pem" : "account.pem");
    let key: Buffer | undefined = await readFile(file).catch(() => undefined);
    if (!key) {
      key = Buffer.from(await acme.crypto.createPrivateKey());
      await writeFile(file, key, { mode: 0o600 });
    }
    this.client = new acme.Client({ directoryUrl: this.opts.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production, accountKey: key });
    return this.client;
  }

  private async issue(hostname: string): Promise<void> {
    await this.checkDns(hostname);
    await this.checkReachable(hostname);
    const client = await this.acmeClient();
    const [key, csr] = await acme.crypto.createCsr({ commonName: hostname });
    const cert = await client.auto({
      csr,
      ...(this.opts.email ? { email: this.opts.email } : {}),
      termsOfServiceAgreed: true,
      challengePriority: ["http-01"],
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        this.challenges.set(challenge.token, keyAuthorization);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        this.challenges.delete(challenge.token);
      },
    });
    // nginx reads these by name (ssl_certificate .../$ssl_server_name/fullchain.pem).
    const dir = join(this.opts.certsDir, hostname);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    // Write both files, then swap them in together.
    await writeFile(join(dir, "privkey.pem.tmp"), key, { mode: 0o640 });
    await chmod(join(dir, "privkey.pem.tmp"), 0o640);
    await writeFile(join(dir, "fullchain.pem.tmp"), cert, { mode: 0o644 });
    await rename(join(dir, "privkey.pem.tmp"), join(dir, "privkey.pem"));
    await rename(join(dir, "fullchain.pem.tmp"), join(dir, "fullchain.pem"));
  }
}
