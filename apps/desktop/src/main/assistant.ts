import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ASSISTANT_PROMPT } from "@prototyper/prototype-kit";
import type { AssistantEvent, DemoRef, Settings, ShareTarget } from "../common/types";
import { describeTool, findClaude, runClaude } from "./claude";
import type { DemoService } from "./demos";
import type { Library } from "./library";

export interface AssistantDeps {
  library: () => Library;
  demos: DemoService;
  settings: () => Settings;
  shareTargets: () => ShareTarget[];
  /** Folder for the assistant's session state and attachments. */
  dataDir: string;
  emit: (event: AssistantEvent) => void;
  /** Ask the UI to open a demo. */
  openDemo: (ref: DemoRef) => void;
}

const now = () => new Date().toISOString();
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * The home chat: a Claude Code session whose only tools are the app's own (served over a local
 * MCP endpoint), so the developer can ask in plain words and the app does the work.
 */
export class AssistantService {
  private server: Server | undefined;
  private url = "";
  private readonly token = randomBytes(24).toString("base64url");
  private running: AbortController | undefined;
  /** Files the developer attached in this conversation; the only local files tools may use. */
  private readonly attachments = new Set<string>();

  constructor(private readonly deps: AssistantDeps) {}

  private get attachmentsDir(): string {
    return join(this.deps.dataDir, "attachments");
  }

  async start(): Promise<void> {
    if (this.server) return;
    await mkdir(this.attachmentsDir, { recursive: true });
    this.server = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${this.token}` || !req.url?.startsWith("/mcp")) {
        res.writeHead(401).end();
        return;
      }
      // Stateless: a fresh MCP server per request.
      const mcp = this.buildMcp();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      try {
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/mcp`;
  }

  stop(): void {
    this.server?.close();
  }

  isRunning(): boolean {
    return !!this.running;
  }

  cancel(): void {
    this.running?.abort();
  }

  // --- conversation ---------------------------------------------------------------------------

  private async state(): Promise<{ sessionId?: string; costUsd?: number }> {
    try {
      return JSON.parse(await readFile(join(this.deps.dataDir, "session.json"), "utf8")) as { sessionId?: string; costUsd?: number };
    } catch {
      return {};
    }
  }

  private async saveState(s: { sessionId?: string; costUsd?: number }): Promise<void> {
    await mkdir(this.deps.dataDir, { recursive: true });
    await writeFile(join(this.deps.dataDir, "session.json"), JSON.stringify(s));
  }

  async log(): Promise<AssistantEvent[]> {
    const text = await readFile(join(this.deps.dataDir, "log.jsonl"), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AssistantEvent];
        } catch {
          return [];
        }
      });
  }

  private async record(event: AssistantEvent): Promise<void> {
    this.deps.emit(event);
    if (event.type === "phase") return;
    await mkdir(this.deps.dataDir, { recursive: true });
    await appendFile(join(this.deps.dataDir, "log.jsonl"), JSON.stringify(event) + "\n");
  }

  /** Start over: new Claude session, empty chat. Attachments on disk are kept for existing demos. */
  async reset(): Promise<void> {
    if (this.running) throw new Error("Wait for the assistant to finish.");
    await this.saveState({});
    await writeFile(join(this.deps.dataDir, "log.jsonl"), "");
    this.attachments.clear();
  }

  /** Copy a dropped file into the attachments folder; returns its new path. */
  async attachFile(path: string): Promise<string> {
    const ext = extname(path).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new Error(`${basename(path)} is not an image (PNG, JPG, WebP or GIF).`);
    const dest = join(this.attachmentsDir, `${Date.now()}-${basename(path).replace(/[^\w.-]+/g, "-")}`);
    await copyFile(path, dest);
    return dest;
  }

  async attachData(data: Uint8Array, ext: string): Promise<string> {
    const clean = `.${ext.replace(/^\./, "").toLowerCase()}`;
    if (!IMAGE_EXT.has(clean)) throw new Error("Unsupported image type.");
    const dest = join(this.attachmentsDir, `${Date.now()}-pasted${clean}`);
    await writeFile(dest, data);
    return dest;
  }

  /** Send a message; resolves when Claude has answered (background jobs keep running). */
  async send(text: string, attachments: string[]): Promise<void> {
    if (this.running) throw new Error("The assistant is still answering.");
    const abort = new AbortController();
    this.running = abort;
    try {
      await this.start();
      for (const a of attachments) this.attachments.add(a);
      await this.record({ type: "user", text, attachments: attachments.map((a) => basename(a)), at: now() });
      this.deps.emit({ type: "phase", message: "", at: now() });

      const settings = this.deps.settings();
      const bin = await findClaude(settings.claudePath);
      if (!bin) {
        await this.record({ type: "error", message: "Claude Code not found. Check Settings.", at: now() });
        return;
      }

      const prompt = attachments.length ? `${text}\n\nAttached images:\n${attachments.map((a) => `- ${a}`).join("\n")}` : text;
      const state = await this.state();
      const library = this.deps.library();
      await mkdir(library.root, { recursive: true });
      const run = (sessionId: string, resume: boolean) =>
        runClaude(
          {
            bin,
            cwd: library.root,
            prompt,
            sessionId,
            resume,
            appendSystemPrompt: ASSISTANT_PROMPT,
            allowedTools: ["mcp__prototyper", "Read", "Glob", "Grep"],
            addDirs: [this.attachmentsDir],
            mcpConfig: JSON.stringify({
              mcpServers: { prototyper: { type: "http", url: this.url, headers: { Authorization: `Bearer ${this.token}` } } },
            }),
            ...(settings.model ? { model: settings.model } : {}),
            ...(settings.isolateClaude ? { isolated: true } : {}),
            signal: abort.signal,
          },
          (e) => {
            if (e.type === "text") void this.record({ type: "assistant", text: e.text, at: now() });
            if (e.type === "tool" && !e.name.startsWith("mcp__prototyper__")) {
              this.deps.emit({ type: "phase", message: `${e.name} ${describeTool(e.name, e.input, library.root)}`, at: now() });
            }
          },
        );

      let result = state.sessionId ? await run(state.sessionId, true) : undefined;
      if (!result || result.sessionMissing) {
        const sessionId = randomUUID();
        await this.saveState({ sessionId, costUsd: 0 });
        result = await run(sessionId, false);
      }
      const before = (await this.state()).costUsd ?? 0;
      if (result.costUsd !== undefined) await this.saveState({ sessionId: result.sessionId, costUsd: result.costUsd });
      if (!result.ok && !abort.signal.aborted) await this.record({ type: "error", message: result.text, at: now() });
      await this.record({
        type: "done",
        ok: result.ok,
        ...(result.costUsd !== undefined ? { costUsd: Math.max(0, result.costUsd - before) } : {}),
        at: now(),
      });
    } finally {
      this.running = undefined;
    }
  }

  /** Called by the app when a background job started from the chat finishes. */
  async notifyJob(ref: DemoRef, text: string, vars: Record<string, string | number>, okResult: boolean): Promise<void> {
    await this.record({ type: "action", text, vars, ref, ok: okResult, at: now() });
  }

  // --- tools ---------------------------------------------------------------------------------

  private buildMcp(): McpServer {
    const mcp = new McpServer({ name: "prototyper", version: "1.0.0" });
    const library = () => this.deps.library();
    const demos = this.deps.demos;
    const ref = { client: z.string().describe("client slug"), demo: z.string().describe("demo slug") };
    const guard = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
      try {
        return await fn();
      } catch (e) {
        return fail((e as Error).message);
      }
    };
    // `text` is an English template translated in the UI; values go in `vars`.
    const action = (text: string, vars: Record<string, string | number>, r?: DemoRef) =>
      void this.record({ type: "action", text, vars, ...(r ? { ref: r } : {}), ok: true, at: now() });

    mcp.registerTool(
      "list_library",
      {
        description: "All clients (with website and whether a brand is saved) and their demos (status, versions, share link, latest client review), plus the configured share domains.",
      },
      () =>
        guard(async () => {
          const clients = await library().list();
          return ok({
            shareDomains: this.deps.shareTargets().map((t) => ({ name: t.name, url: t.baseUrl })),
            clients: clients.map((c) => ({
              slug: c.slug,
              name: c.name,
              website: c.website ?? null,
              hasBrand: c.hasBrand,
              demos: c.demos.map((d) => ({
                slug: d.slug,
                name: d.name,
                status: d.status,
                language: d.language,
                pages: d.pages,
                latestVersion: d.versions.at(-1)?.number ?? null,
                updatedAt: d.updatedAt,
                running: demos.isRunning({ client: c.slug, demo: d.slug }),
                shareUrl: d.share?.url ?? null,
                clientReview: d.lastRound ? { status: d.lastRound.status, edits: d.lastRound.edits, notes: d.lastRound.comments } : null,
              })),
            })),
          });
        }),
    );

    mcp.registerTool(
      "get_demo",
      { description: "Details of one demo: brief, pages, versions, changelog, checks, references.", inputSchema: ref },
      (args) =>
        guard(async () => {
          const r = { client: args.client, demo: args.demo };
          const detail = await demos.detail(r);
          const brief = await readFile(join(detail.dir, "brief.md"), "utf8").catch(() => "");
          const changelog = await readFile(join(detail.dir, "CHANGELOG.md"), "utf8").catch(() => "");
          const references = await demos.listReferences(r);
          return ok({
            name: detail.meta.name,
            client: detail.clientName,
            status: detail.meta.status,
            pages: detail.meta.pages,
            versions: detail.meta.versions.map((v) => `v${v.number}: ${v.summary}`),
            running: detail.running,
            hasPages: detail.hasPages,
            unsavedChanges: detail.unsavedChanges,
            checks: detail.lint ? { errors: detail.lint.errors, warnings: detail.lint.warnings } : null,
            shareUrl: detail.meta.share?.url ?? null,
            brief: brief.slice(0, 6000),
            changelog: changelog.slice(0, 3000),
            references: references.map((x) => ({ file: x.file, note: x.note })),
          });
        }),
    );

    mcp.registerTool(
      "create_client",
      {
        description: "Create a new client. Check list_library first: don't duplicate an existing client.",
        inputSchema: { name: z.string().min(1), website: z.string().optional().describe("their current website, if known") },
      },
      (args) =>
        guard(async () => {
          const info = await library().createClient({ name: args.name, ...(args.website ? { website: args.website } : {}) });
          action("Created client {name}", { name: info.name });
          return ok({ slug: info.slug, name: info.name });
        }),
    );

    mcp.registerTool(
      "update_client",
      { description: "Change a client's name or website.", inputSchema: { client: z.string(), name: z.string().optional(), website: z.string().optional() } },
      (args) =>
        guard(async () => {
          const info = await library().updateClient(args.client, { ...(args.name ? { name: args.name } : {}), ...(args.website ? { website: args.website } : {}) });
          return ok({ slug: info.slug, name: info.name, website: info.website ?? null });
        }),
    );

    mcp.registerTool(
      "create_demo",
      {
        description:
          "Create a demo for an existing client and start generating it in the background (a few minutes). Returns immediately. With extract_brand, the client's brand is first extracted from their website (needs a website on the client).",
        inputSchema: {
          client: z.string().describe("client slug"),
          name: z.string().min(1).describe("short demo name, e.g. 'Landing 2027'"),
          brief: z.string().min(1).describe("rich brief in the content language: client, audience, goal and call to action, sections, tone, known facts"),
          language: z.string().default("Italian").describe("language of the site's copy"),
          pages: z.array(z.string()).default(["Home"]),
          extract_brand: z.boolean().default(false),
          structure_first: z.boolean().default(false).describe("only propose a sitemap first; pages are built after the developer approves"),
          reference_urls: z.array(z.string()).default([]).describe("websites to capture as reference screenshots"),
          reference_files: z.array(z.object({ path: z.string(), note: z.string().default("") })).default([]).describe("attached images to use as references"),
        },
      },
      (args) =>
        guard(async () => {
          for (const f of args.reference_files) if (!this.attachments.has(f.path)) return fail(`Not an attached file: ${f.path}`);
          const meta = await demos.create({
            client: args.client,
            name: args.name,
            language: args.language,
            pages: args.pages,
            brief: args.brief,
            structureFirst: args.structure_first,
            references: args.reference_files,
          });
          const r = { client: args.client, demo: meta.slug };
          action("Started demo “{name}”", { name: meta.name }, r);
          void demos
            .generate(r, { structureFirst: args.structure_first, extractBrand: args.extract_brand, ...(args.reference_urls.length ? { referenceUrls: args.reference_urls } : {}) })
            .then(async () => {
              const d = await demos.detail(r);
              const done = d.meta.pendingStructure ? "Structure of “{name}” ready for your review" : d.hasPages ? "“{name}” is ready (v{n})" : "“{name}” did not complete";
              await this.notifyJob(r, done, { name: meta.name, n: d.meta.versions.at(-1)?.number ?? 1 }, d.hasPages || !!d.meta.pendingStructure);
            });
          return ok({ client: args.client, demo: meta.slug, status: "generation started in the background" });
        }),
    );

    mcp.registerTool(
      "request_change",
      {
        description: "Ask the demo's own Claude session to change an existing demo (text, layout, sections, style). Runs in the background.",
        inputSchema: { ...ref, instructions: z.string().min(1).describe("the change, written as the developer would ask it") },
      },
      (args) =>
        guard(async () => {
          const r = { client: args.client, demo: args.demo };
          if (demos.isRunning(r)) return fail("Claude is already working on this demo; try again when it finishes.");
          const meta = await library().readMeta(r);
          action("Asked for changes to “{name}”", { name: meta.name }, r);
          void demos.chat(r, args.instructions).then(() => this.notifyJob(r, "Changes to “{name}” are done", { name: meta.name }, true));
          return ok({ status: "change started in the background" });
        }),
    );

    mcp.registerTool(
      "extract_brand",
      {
        description: "Extract a client's brand (colors, fonts, logo, tone of voice) from their website. Runs in the background (a couple of minutes). Not needed before create_demo with extract_brand.",
        inputSchema: { client: z.string(), website: z.string().optional().describe("defaults to the client's saved website") },
      },
      (args) =>
        guard(async () => {
          const info = await library().getClient(args.client);
          const site = args.website ?? info.website;
          if (!site) return fail("This client has no website. Ask for it, or create demos without a brand.");
          action("Extracting the brand of {name} from {site}", { name: info.name, site });
          void demos
            .extractBrand(args.client, site, () => {})
            .then((done) => this.record({ type: "action", text: done ? "Brand of {name} saved" : "Brand extraction for {name} did not complete", vars: { name: info.name }, ok: done, at: now() }))
            .catch((e: Error) => this.record({ type: "action", text: "Brand extraction failed: {error}", vars: { error: e.message }, ok: false, at: now() }));
          return ok({ status: "brand extraction started in the background" });
        }),
    );

    mcp.registerTool(
      "add_reference",
      {
        description: "Add a reference to a demo: an attached image (file_path) or a website to capture (url), with a note on what to take from it.",
        inputSchema: { ...ref, file_path: z.string().optional(), url: z.string().optional(), note: z.string().default("") },
      },
      (args) =>
        guard(async () => {
          const r = { client: args.client, demo: args.demo };
          if (args.file_path) {
            if (!this.attachments.has(args.file_path)) return fail(`Not an attached file: ${args.file_path}`);
            await demos.addReferenceFiles(r, [args.file_path]);
            const refs = await demos.listReferences(r);
            const last = refs.at(-1);
            if (last && args.note) await demos.setReferenceNote(r, last.file, args.note);
          } else if (args.url) {
            await demos.addReferenceUrl(r, args.url, args.note);
          } else return fail("Give file_path or url.");
          action("Added a reference", {}, r);
          return ok({ status: "reference added" });
        }),
    );

    mcp.registerTool(
      "open_demo",
      { description: "Open a demo in the app so the developer sees its preview and progress.", inputSchema: ref },
      (args) =>
        guard(async () => {
          await library().readMeta({ client: args.client, demo: args.demo });
          this.deps.openDemo({ client: args.client, demo: args.demo });
          return ok({ status: "opened" });
        }),
    );

    mcp.registerTool(
      "publish_demo",
      {
        description: "Publish the demo's latest saved version for client review and get the link. Only when the developer explicitly asks to share or publish.",
        inputSchema: { ...ref, domain: z.string().optional().describe("share domain name or URL; defaults to the one already used, or the first configured") },
      },
      (args) =>
        guard(async () => {
          const r = { client: args.client, demo: args.demo };
          const meta = await library().readMeta(r);
          const targets = this.deps.shareTargets();
          if (!targets.length) return fail("No share domain configured. The developer must add one in Settings.");
          const wanted = args.domain?.toLowerCase();
          const target =
            (wanted && targets.find((t) => t.name.toLowerCase() === wanted || t.baseUrl.toLowerCase().includes(wanted))) ||
            targets.find((t) => t.id === meta.share?.targetId) ||
            targets[0]!;
          const info = await demos.publish(r, target.id);
          action("Published “{name}” v{n}", { name: meta.name, n: info.publishedVersion }, r);
          return ok({ url: info.url, version: info.publishedVersion });
        }),
    );

    return mcp;
  }
}
