import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { AddressInfo } from "node:net";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

const RELOAD_SNIPPET = (id: string) =>
  `<script>(()=>{const es=new EventSource("/__reload/${id}");es.onmessage=()=>location.reload();})();</script>`;

/**
 * Local preview server: `/p/<id>/…` serves `<demo>/dist`, with live reload over SSE.
 * Binds to 127.0.0.1 only.
 */
export class PreviewServer {
  private server: Server | undefined;
  private port = 0;
  private readonly roots = new Map<string, string>();
  private readonly listeners = new Map<string, Set<ServerResponse>>();

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        res.writeHead(500).end("Internal error");
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Register a demo's dist folder; returns its preview URL. */
  mount(id: string, distDir: string): string {
    this.roots.set(id, distDir);
    return `http://127.0.0.1:${this.port}/p/${id}/`;
  }

  reload(id: string): void {
    for (const res of this.listeners.get(id) ?? []) res.write("data: reload\n\n");
  }

  stop(): void {
    for (const set of this.listeners.values()) for (const res of set) res.end();
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    const reload = /^\/__reload\/([\w-]+)$/.exec(url.pathname);
    if (reload) {
      const id = reload[1]!;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      const set = this.listeners.get(id) ?? new Set();
      set.add(res);
      this.listeners.set(id, set);
      req.on("close", () => set.delete(res));
      return;
    }

    const m = /^\/p\/([\w-]+)(\/.*)?$/.exec(url.pathname);
    const root = m ? this.roots.get(m[1]!) : undefined;
    if (!m || !root) return void res.writeHead(404).end("Not found");
    if (m[2] === undefined) return void res.writeHead(302, { Location: `/p/${m[1]}/` }).end();

    let rel = decodeURIComponent(m[2]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end("Forbidden");

    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) {
      const notBuilt = rel === "/index.html";
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><body style="font:14px system-ui;color:#666;display:grid;place-items:center;height:90vh">` +
          `${notBuilt ? "Nothing to preview yet." : "Page not found."}${RELOAD_SNIPPET(m[1]!)}</body>`,
      );
      return;
    }

    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "no-store" };
    if (type.startsWith("text/html")) {
      const html = await readFile(file, "utf8");
      const snippet = RELOAD_SNIPPET(m[1]!);
      const body = html.includes("</body>") ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${snippet}</body>`) : html + snippet;
      res.writeHead(200, headers).end(body);
    } else {
      res.writeHead(200, headers).end(await readFile(file));
    }
  }
}
