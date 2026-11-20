import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { createSecureContext, type SecureContext } from "node:tls";
import type { FastifyInstance } from "fastify";

/**
 * Standalone mode (no nginx in front, e.g. the Docker image on a dedicated server): Prototyper itself
 * terminates HTTPS on 443, picking each hostname's certificate from the certificates folder, and
 * answers on 80 with certificate challenges and a redirect to HTTPS.
 */

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const RECHECK_MS = 60_000;

/** TLS SNI callback that loads `<certsDir>/<servername>/{fullchain,privkey}.pem`, reloading renewed ones. */
export function sniFromCertsDir(certsDir: string): (servername: string, cb: (err: Error | null, ctx?: SecureContext) => void) => void {
  const cache = new Map<string, { ctx: SecureContext; mtime: number; checked: number }>();
  const load = async (name: string): Promise<SecureContext> => {
    const dir = join(certsDir, name);
    const hit = cache.get(name);
    if (hit && Date.now() - hit.checked < RECHECK_MS) return hit.ctx;
    const mtime = (await stat(join(dir, "fullchain.pem"))).mtimeMs;
    if (hit && hit.mtime === mtime) {
      hit.checked = Date.now();
      return hit.ctx;
    }
    const [cert, key] = await Promise.all([readFile(join(dir, "fullchain.pem")), readFile(join(dir, "privkey.pem"))]);
    const ctx = createSecureContext({ cert, key });
    cache.set(name, { ctx, mtime, checked: Date.now() });
    return ctx;
  };
  return (servername, cb) => {
    const name = servername.toLowerCase();
    if (!HOSTNAME.test(name)) return cb(new Error("unknown host"));
    load(name).then(
      (ctx) => cb(null, ctx),
      () => {
        cache.delete(name);
        cb(new Error(`no certificate for ${name}`));
      },
    );
  };
}

/** Plain HTTP: certificate challenges go to the app, everything else is redirected to HTTPS. */
export function httpRedirectServer(app: FastifyInstance): Server {
  return createServer((req, res) => {
    const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
    const url = req.url ?? "/";
    if (url.startsWith("/.well-known/acme-challenge/") && (req.method === "GET" || req.method === "HEAD")) {
      app.inject({ method: req.method, url, headers: { host } }).then(
        (r) => {
          res.writeHead(r.statusCode, { "content-type": String(r.headers["content-type"] ?? "text/plain") });
          res.end(req.method === "HEAD" ? undefined : r.rawPayload);
        },
        () => {
          res.writeHead(500).end();
        },
      );
      return;
    }
    if (!HOSTNAME.test(host) || !url.startsWith("/")) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Bad request");
      return;
    }
    res.writeHead(301, { location: `https://${host}${url}` }).end();
  });
}
