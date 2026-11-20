import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { normalizeServer, readCredentials, saveCredentials } from "./config.js";

export interface LoginResult {
  server: string;
  email: string;
  name: string;
}

interface PendingLogin {
  server: string;
  url: string;
  done: Promise<LoginResult>;
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#1b1c1f;background:#f6f6f4">` +
  `<div style="text-align:center;max-width:28rem"><h1 style="font-size:20px">${title}</h1><p style="color:#6b6e76">${text}</p></div>`;

function openBrowser(url: string): void {
  // Headless machines (or tests): only show the link.
  if (process.env.PROTOTYPER_NO_BROWSER === "1") {
    console.error(`Prototyper login: open ${url}`);
    return;
  }
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  execFile(cmd, args, () => {});
}

let pending: PendingLogin | undefined;

/**
 * Sign in through the browser: OAuth authorization code + PKCE with a loopback redirect (RFC 8252).
 * The panel asks for the password and a fresh 2FA code, then sends the browser back here with a
 * one-time code, exchanged for an API token stored in the credentials file. The flow keeps running
 * in the background if the tool call returns first.
 */
export async function beginLogin(serverInput: string): Promise<PendingLogin> {
  const server = normalizeServer(serverInput);
  if (pending?.server === server) return pending;

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  let redirectUri = "";
  let settle: (err?: Error, r?: LoginResult) => void = () => {};
  const done = new Promise<LoginResult>((resolve, reject) => {
    settle = (err, r) => (err ? reject(err) : resolve(r!));
  });
  done.catch(() => {});

  const http = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") return void res.writeHead(404).end();
    if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Login failed", "Invalid response. Start the login again from Claude Code."));
      return;
    }
    try {
      const r = await fetch(`${server}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: u.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirectUri }),
      });
      const body = (await r.json()) as { access_token?: string; expires_in?: number; user?: { email: string; name: string }; error?: string };
      if (!r.ok || !body.access_token || !body.user) throw new Error(body.error ?? `HTTP ${r.status}`);
      const creds = await readCredentials();
      creds.servers[server] = {
        token: body.access_token,
        email: body.user.email,
        name: body.user.name,
        expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000).toISOString(),
      };
      creds.default = server;
      await saveCredentials(creds);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Claude Code is connected", "You can close this tab and go back to the terminal."));
      finish(undefined, { server, email: body.user.email, name: body.user.name });
    } catch (e) {
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Login failed", "Start the login again from Claude Code."));
      finish(e as Error);
    }
  });

  const timer = setTimeout(() => finish(new Error("The login timed out (10 minutes). Start it again.")), 10 * 60_000);
  const finish = (err?: Error, r?: LoginResult) => {
    clearTimeout(timer);
    setTimeout(() => http.close(), 500).unref();
    if (pending?.done === done) pending = undefined;
    settle(err, r);
  };

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  redirectUri = `http://127.0.0.1:${(http.address() as AddressInfo).port}/callback`;
  const auth = new URL(`${server}/oauth/authorize`);
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: "prototyper-mcp",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    client_name: `Claude Code on ${hostname().replace(/\.local$/, "")}`,
  }).toString();
  openBrowser(auth.toString());
  pending = { server, url: auth.toString(), done };
  return pending;
}

/** A login started earlier and still waiting for the browser, if any. */
export const pendingLogin = () => pending;
