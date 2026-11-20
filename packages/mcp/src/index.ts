import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as tar from "tar";
import { z } from "zod";
import { formatIssues, lintDemo, readSite } from "@prototyper/shared";
import { Api, type ContentValue, type Feedback, type Me, type ProjectSummary, type SourceInfo } from "./client.js";
import { BehindError, GitMissingError, SourceRepo, type Remote } from "./git.js";
import { PROJECT_FILE, normalizeServer, projectRoot, readCredentials, readProjectLink, writeProjectLink } from "./config.js";
import { beginLogin, pendingLogin } from "./login.js";

const VERSION = "0.1.0";
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });
const guard = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (e) {
    return fail((e as Error).message);
  }
};

const SKIP = new Set(["node_modules", ".git", ".DS_Store", ".prototyper", ".prototyper.json"]);
const MAX_BYTES = 200 * 1024 * 1024;

/** Gzipped tarball of a built site folder, without dotfiles and dependency folders. */
async function packSite(dir: string): Promise<Buffer> {
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`${dir} is not a folder. Pass the folder of the built site (e.g. dist/).`);
  const entries = await readdir(dir);
  if (!entries.includes("index.html")) throw new Error(`${dir} has no index.html at its root. Pass the folder of the built site (e.g. dist/, out/, build/).`);
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = tar.c({ gzip: true, cwd: dir, portable: true, follow: false, filter: (p) => !p.split("/").some((part) => SKIP.has(part) || (part.startsWith(".") && part !== ".")) }, ["."]);
  for await (const c of stream as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error("The site is larger than 200 MB once compressed. Leave out videos or other large files.");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function pickWorkspace(me: Me, wanted?: string) {
  if (!me.workspaces.length) throw new Error("Your Prototyper account isn't in any workspace yet. Ask an admin to add you.");
  if (wanted) {
    const w = me.workspaces.find((x) => x.id === wanted || x.name.toLowerCase() === wanted.toLowerCase());
    if (!w) throw new Error(`No workspace "${wanted}". Yours: ${me.workspaces.map((x) => x.name).join(", ")}.`);
    return w;
  }
  if (me.workspaces.length > 1) throw new Error(`Pick a workspace (workspace parameter): ${me.workspaces.map((x) => x.name).join(", ")}.`);
  return me.workspaces[0]!;
}

function describeValue(v: ContentValue | null): string {
  if (!v) return "(missing)";
  switch (v.kind) {
    case "text":
      return JSON.stringify(v.text);
    case "rich":
      return `${JSON.stringify(v.html)} (rich text: keep only b, strong, i, em, a, br)`;
    case "link":
      return `${JSON.stringify(v.text)} → ${v.href}`;
    case "image":
      return `image ${v.src}${v.alt !== undefined ? `, alt ${JSON.stringify(v.alt)}` : ""}`;
    case "bg":
      return `background image ${v.src}`;
  }
}

async function linkedProject(projectDir?: string) {
  const root = projectRoot(projectDir);
  const link = await readProjectLink(root);
  if (!link) throw new Error(`This folder (${root}) is not linked to a Prototyper project yet: publish it first, or use link_project.`);
  const api = await Api.connect(link.server);
  return { root, link, api };
}

/** The project's git on the server, if the server keeps sources. */
async function sourceRemote(api: Api, projectId: string): Promise<(Remote & { head: string | null }) | undefined> {
  const s = await api.request<SourceInfo>("GET", `/api/v1/projects/${projectId}/source`).catch(() => undefined);
  return s?.git ? { url: s.git, token: api.token, head: s.head } : undefined;
}

const author = (api: Api) => ({ name: api.user.name, email: api.user.email });
const short = (sha: string) => sha.slice(0, 7);

/** Folder names build tools write to. A published folder with another name (e.g. `site/` of a hand-written site) is the source itself. */
const BUILD_OUTPUTS = new Set(["dist", "build", "out", "_site", ".output", "output", "storybook-static", ".next", ".svelte-kit", ".vercel"]);

function isBuildOutput(root: string, buildDir: string): boolean {
  const rel = relative(root, buildDir);
  if (!rel || rel.startsWith("..")) return false;
  return rel.split(sep).some((part) => BUILD_OUTPUTS.has(part));
}

/**
 * Save the folder's sources as a commit on the server's `main`, on top of what is there. Refused when
 * the server has sources this folder hasn't pulled yet. Returns the commit, or a note when not saved.
 */
async function pushSources(api: Api, projectId: string, root: string, buildDir: string, message: string): Promise<{ commit?: string; note?: string }> {
  const remote = await sourceRemote(api, projectId);
  if (!remote) return { note: "This server doesn't keep sources (no git there): only the built site was published." };
  try {
    const repo = await SourceRepo.open(root);
    const head = await repo.remoteHead(remote);
    const base = await repo.base();
    if (head && head !== base) {
      throw new BehindError(
        base
          ? "The sources on Prototyper changed since this folder last synced (someone else published). Run pull_sources to merge them, check the result, rebuild, then publish again."
          : "This project already has sources on Prototyper that this folder never pulled. Run pull_sources to merge them (or clone_project into a new folder), then publish again.",
      );
    }
    const commit = await repo.snapshot(message, author(api), head ?? base, isBuildOutput(root, buildDir) ? buildDir : undefined);
    if (commit !== head) await repo.push(remote, commit);
    await repo.setBase(commit);
    return { commit };
  } catch (e) {
    if (e instanceof BehindError) throw e;
    if (e instanceof GitMissingError) return { note: e.message };
    return { note: `The sources were not saved on Prototyper: ${(e as Error).message}` };
  }
}

function slug(name: string): string {
  return name.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
}

const server = new McpServer({ name: "prototyper", version: VERSION });

server.registerTool(
  "login",
  {
    title: "Sign in to Prototyper",
    description:
      "Sign in to a Prototyper server through the browser (password + two-factor code). Needed once per computer; afterwards every tool acts as that user. `server` is the panel address, e.g. prototyper.example.com (defaults to the last one used).",
    inputSchema: { server: z.string().optional() },
  },
  ({ server: s }) =>
    guard(async () => {
      const creds = await readCredentials();
      const target = s ? normalizeServer(s) : (pendingLogin()?.server ?? creds.default);
      if (!target) return fail("Which Prototyper server? Pass `server`, the panel address (e.g. prototyper.example.com).");
      const login = await beginLogin(target);
      const result = await Promise.race([login.done, new Promise<undefined>((r) => setTimeout(() => r(undefined), 120_000).unref())]);
      if (!result) {
        return text(
          `I opened the browser to sign in to ${target}. Finish there (password, then the 2FA code, then Authorize); the login completes by itself.\nIf the browser didn't open, open this link:\n${login.url}`,
        );
      }
      return text(`Signed in to ${result.server} as ${result.name || result.email} (${result.email}).`);
    }),
);

server.registerTool(
  "whoami",
  {
    title: "Prototyper account",
    description: "The signed-in user, their workspaces (with preview domains and clients), and the Prototyper project this folder is linked to.",
    inputSchema: { project_dir: z.string().optional() },
  },
  ({ project_dir }) =>
    guard(async () => {
      const root = projectRoot(project_dir);
      const link = await readProjectLink(root);
      const api = await Api.connect(link?.server);
      const me = await api.request<Me>("GET", "/api/v1/me");
      const lines = [`Signed in to ${api.server} as ${me.user.name || me.user.email} (${me.user.email}).`, "", "Workspaces:"];
      for (const w of me.workspaces) {
        lines.push(`- ${w.name} — domains: ${w.domains.map((d) => d.hostname).join(", ") || "none active"} — clients: ${w.clients.join(", ") || "none yet"}`);
      }
      if (link) {
        const p = await api.request<ProjectSummary>("GET", `/api/v1/projects/${link.projectId}`).catch(() => undefined);
        lines.push("", p ? `This folder publishes to “${p.name}” (${p.client?.name ?? "?"}): ${p.url ?? "not published yet"}` : `This folder is linked to project ${link.projectId}, which is not available any more.`);
      } else lines.push("", "This folder is not linked to a Prototyper project yet.");
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "list_projects",
  {
    title: "List Prototyper projects",
    description: "Projects in your workspaces with their link, latest version and client review status.",
    inputSchema: { workspace: z.string().optional().describe("workspace name or id") },
  },
  ({ workspace }) =>
    guard(async () => {
      const api = await Api.connect();
      const me = await api.request<Me>("GET", "/api/v1/me");
      const ws = workspace ? pickWorkspace(me, workspace) : undefined;
      const projects = await api.request<ProjectSummary[]>("GET", `/api/v1/projects${ws ? `?workspaceId=${ws.id}` : ""}`);
      if (!projects.length) return text("No projects yet.");
      return text(
        projects
          .map((p) => {
            const w = me.workspaces.find((x) => x.id === p.workspaceId)?.name ?? "";
            const review = p.round ? `review of v${p.round.versionNumber}: ${p.round.status} (${p.round.edits} edits, ${p.round.comments} notes)` : "not published";
            return `- ${p.name} — ${p.client?.name ?? "?"} [${w}] — id ${p.id}\n  ${p.url ?? "no link yet"} — ${review}`;
          })
          .join("\n"),
      );
    }),
);

server.registerTool(
  "link_project",
  {
    title: "Link this folder to a Prototyper project",
    description: "Link the current project folder to an existing Prototyper project (e.g. one published from another computer), so publish and check_feedback use it.",
    inputSchema: { project_id: z.string(), project_dir: z.string().optional() },
  },
  ({ project_id, project_dir }) =>
    guard(async () => {
      const api = await Api.connect();
      const p = await api.request<ProjectSummary>("GET", `/api/v1/projects/${encodeURIComponent(project_id)}`);
      const root = projectRoot(project_dir);
      await writeProjectLink(root, { server: api.server, projectId: p.id, name: p.name });
      return text(`Linked ${root} to “${p.name}” (${p.client?.name ?? "?"}). Wrote ${PROJECT_FILE}.`);
    }),
);

server.registerTool(
  "clone_project",
  {
    title: "Get a Prototyper project's code",
    description:
      "Download an existing Prototyper project into a new folder, to work on it from this computer: its sources as last published (or, for projects published before sources were kept, the built site), linked to the project so publish makes the next version on the same client link. Pass the new folder as project_dir to the other tools afterwards.",
    inputSchema: {
      project: z.string().describe("project name or id (see list_projects)"),
      dir: z.string().optional().describe("destination folder, new or empty; defaults to the project name, next to the current folder's contents"),
    },
  },
  ({ project, dir }) =>
    guard(async () => {
      const api = await Api.connect();
      const all = await api.request<ProjectSummary[]>("GET", "/api/v1/projects");
      const wanted = project.trim().toLowerCase();
      const matches = all.filter((p) => p.id === project.trim() || p.name.toLowerCase() === wanted);
      const found = matches.length ? matches : all.filter((p) => p.name.toLowerCase().includes(wanted));
      if (!found.length) return fail(`No project “${project}”. Use list_projects to see them.`);
      if (found.length > 1) return fail(`Several projects match “${project}”: ${found.map((p) => `${p.name} (${p.client?.name ?? "?"}, id ${p.id})`).join("; ")}. Pass the id.`);
      const p = found[0]!;
      if (!p.latestVersion) return fail(`“${p.name}” has not been published yet: there is nothing to download.`);

      const dest = resolve(projectRoot(), dir ?? slug(p.name));
      const existing = await readdir(dest).catch(() => undefined);
      if (existing?.length) return fail(`${dest} already exists and is not empty. Pass another dir.`);
      await mkdir(dest, { recursive: true });

      const remote = await sourceRemote(api, p.id);
      let what: string;
      let head: string | undefined;
      if (remote) {
        const repo = await SourceRepo.open(dest).catch((e: Error) => {
          if (e instanceof GitMissingError) return undefined;
          throw e;
        });
        head = repo ? await repo.remoteHead(remote) : undefined;
        if (repo && head) {
          await repo.fetch(remote, head);
          await repo.checkout(head);
          await repo.setBase(head);
        }
      }
      if (head) {
        what = `the sources as of v${p.latestVersion.number} (commit ${short(head)})`;
      } else {
        const tgz = await api.download(`/api/v1/projects/${p.id}/versions/latest/files`);
        await pipeline(Readable.from(tgz), tar.x({ cwd: dest, strict: true }));
        what = `the built files of v${p.latestVersion.number}: its sources were never saved on Prototyper, so this is the compiled site (fine for plain HTML/CSS/JS; with a framework, rebuild the sources from it)`;
      }
      await writeProjectLink(dest, { server: api.server, projectId: p.id, name: p.name });

      const lines = [`Downloaded “${p.name}” (${p.client?.name ?? "?"}) into ${dest}: ${what}.`, `It is linked to the project (${PROJECT_FILE}): publish makes v${p.latestVersion.number + 1} on the same client link ${p.url ?? ""}.`];
      if (p.round && p.round.status === "submitted") lines.push(`The client sent a review of v${p.round.versionNumber} (${p.round.edits} edits, ${p.round.comments} notes) that hasn't been applied yet: run check_feedback.`);
      lines.push(`Pass project_dir: "${dest}" to publish, lint, check_feedback and the other tools.`);
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "pull_sources",
  {
    title: "Get teammates' changes",
    description:
      "Merge into this folder the sources a teammate published on Prototyper since this folder last synced (three-way merge; local changes are kept). Conflicts are left as <<<<<<< ======= >>>>>>> markers in the listed files: resolve them, rebuild, then publish.",
    inputSchema: { project_dir: z.string().optional() },
  },
  ({ project_dir }) =>
    guard(async () => {
      const { root, link, api } = await linkedProject(project_dir);
      const remote = await sourceRemote(api, link.projectId);
      if (!remote) return fail("This Prototyper server doesn't keep sources (no git there).");
      const repo = await SourceRepo.open(root);
      const head = await repo.remoteHead(remote);
      if (!head) return text("There are no sources on Prototyper yet for this project: publish saves them.");
      const base = await repo.base();
      if (base === head) return text("Already up to date with the sources on Prototyper.");
      await repo.fetch(remote, head);
      const conflicts = [...new Set(await repo.merge(head, author(api)))];
      const lines = [`Merged the sources from Prototyper (commit ${short(head)}) into ${root}.`];
      if (!base) lines.push("This folder had never been synced, so every file that differs from Prototyper's is a conflict.");
      if (conflicts.length) {
        lines.push("", `Conflicts in ${conflicts.length} file(s): resolve the <<<<<<< ======= >>>>>>> markers (keep both sides' intent), then rebuild and publish:`, ...conflicts.map((f) => `- ${f}`));
      } else lines.push("No conflicts. Rebuild and check the site before publishing.");
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "lint",
  {
    title: "Check the data-pt contract",
    description: "Check the built site against the data-pt content contract (what makes texts and images editable by the client). Run it on the build output before publishing.",
    inputSchema: { dir: z.string().describe("folder of the built site, e.g. dist") , project_dir: z.string().optional() },
  },
  ({ dir, project_dir }) =>
    guard(async () => {
      const abs = resolve(projectRoot(project_dir), dir);
      const site = await readSite(abs);
      if (!site.pages.length) return fail(`No HTML pages in ${abs}.`);
      const result = lintDemo(site);
      const errors = result.issues.filter((i) => i.severity === "error").length;
      const warnings = result.issues.length - errors;
      const summary = `${site.pages.length} pages, ${result.content.size} editable keys, ${errors} errors, ${warnings} warnings.`;
      return text(result.issues.length ? `${summary}\n\n${formatIssues(result.issues)}` : `${summary} All good.`);
    }),
);

server.registerTool(
  "publish",
  {
    title: "Publish to Prototyper",
    description:
      "Upload the built site as a new version and return the client review link. It also saves the project's sources (this folder, minus .gitignore'd files, dependencies, secrets and the build output) on Prototyper, so teammates can clone_project it. The first time it creates the project (name, client and, if you have several, workspace are needed) and links this folder to it in .prototyper.json; later calls publish new versions on the same link. Always build first and pass the build output folder. If teammates published newer sources meanwhile, it stops and asks to run pull_sources first.",
    inputSchema: {
      dir: z.string().describe("folder of the built site (with index.html at its root), relative to the project, e.g. dist"),
      changelog: z.string().default("").describe("what changed, for the client, in the site's language (shown as “What's new”); empty for the first version"),
      name: z.string().optional().describe("project name, first publish only"),
      client: z.string().optional().describe("client name, first publish only (an existing client is reused)"),
      workspace: z.string().optional().describe("workspace name, first publish only, if you have several"),
      domain: z.string().optional().describe("preview domain, first publish only; defaults to the workspace's first"),
      project_dir: z.string().optional(),
    },
  },
  (args) =>
    guard(async () => {
      const root = projectRoot(args.project_dir);
      const dir = resolve(root, args.dir);
      let link = await readProjectLink(root);
      const api = await Api.connect(link?.server);
      const tarball = await packSite(dir);

      let created = false;
      const linked = link;
      if (!link) {
        if (!args.name || !args.client) return fail("First publish of this folder: pass `name` (the project) and `client`.");
        const me = await api.request<Me>("GET", "/api/v1/me");
        const ws = pickWorkspace(me, args.workspace);
        const p = await api.request<ProjectSummary>("POST", "/api/v1/projects", { workspaceId: ws.id, client: args.client, name: args.name, ...(args.domain ? { domain: args.domain } : {}) });
        link = { server: api.server, projectId: p.id, name: p.name };
        await writeProjectLink(root, link);
        created = true;
      }
      let sources: { commit?: string; note?: string };
      try {
        sources = await pushSources(api, link.projectId, root, dir, args.changelog.trim() || (created ? "First version" : "New version"));
      } catch (e) {
        if (e instanceof BehindError && linked) return fail(e.message);
        throw e;
      }
      const r = await api.request<{ version: { number: number }; url: string | null; warnings: number; errors: string[] }>(
        "POST",
        `/api/v1/projects/${link.projectId}/versions?changelog=${encodeURIComponent(args.changelog)}${sources.commit ? `&commit=${sources.commit}` : ""}`,
        tarball,
        "application/gzip",
      );
      const lines = [
        `Published v${r.version.number}${created ? ` of the new project “${link.name}” (linked in ${PROJECT_FILE})` : ""}.`,
        `Client link: ${r.url ?? "(no preview domain)"}`,
      ];
      if (r.version.number > 1) lines.push("Same link as before: the client sees “What's new” and the replies to their notes.");
      lines.push(sources.commit ? `Sources saved on Prototyper (commit ${short(sources.commit)}): teammates can get them with clone_project.` : (sources.note ?? ""));
      if (r.errors.length) lines.push("", `Contract errors (the client can't edit these spots): ${r.errors.length}`, ...r.errors.slice(0, 15).map((e) => `- ${e}`), "Run lint on the build for details.");
      else if (r.warnings) lines.push(`${r.warnings} contract warnings (run lint to see them).`);
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "check_feedback",
  {
    title: "Check client feedback",
    description:
      "Read the client's review of the latest version: their direct edits (by data-pt key, with old and new values; uploaded images are downloaded into .prototyper/feedback/) and their notes. Apply edits and notes in the sources, rebuild, publish with a changelog, then call reply.",
    inputSchema: { project_dir: z.string().optional() },
  },
  ({ project_dir }) =>
    guard(async () => {
      const { root, link, api } = await linkedProject(project_dir);
      const p = await api.request<ProjectSummary>("GET", `/api/v1/projects/${link.projectId}`);
      const fb = await api.request<Feedback>("GET", `/api/v1/projects/${link.projectId}/feedback`);
      const r = fb.round;
      const head = `“${p.name}” (${p.client?.name ?? "?"}) — review of v${r.versionNumber}, round ${r.id}: `;
      if (r.status === "imported") return text(`${head}already imported. Nothing new since then: the client hasn't reviewed a newer version yet.\nLink: ${p.url}`);
      if (!fb.edits.length && !fb.comments.length) return text(`${head}no edits or notes yet. The client hasn't started reviewing.\nLink: ${p.url}`);

      // Download the client's images next to the project.
      const imgDir = join(root, ".prototyper", "feedback", `round-${r.id}`);
      const local = new Map<string, string>();
      for (const u of fb.uploads) {
        if (!fb.edits.some((e) => "src" in e.value && e.value.src.endsWith(u.id))) continue;
        await mkdir(imgDir, { recursive: true });
        const file = join(imgDir, `${u.key}-${u.id.slice(0, 8)}.webp`);
        await writeFile(file, await api.download(u.url));
        local.set(u.id, `${relative(root, file)} (${u.width}×${u.height}, WebP)`);
      }
      const img = (v: ContentValue) => {
        if (v.kind !== "image" && v.kind !== "bg") return describeValue(v);
        const id = /__pt\/uploads\/([0-9a-f-]{36})$/.exec(v.src)?.[1];
        const where = id ? local.get(id) : undefined;
        return `${v.kind === "bg" ? "new background image" : "new image"}: ${where ?? v.src}${v.kind === "image" && v.alt !== undefined ? `, alt ${JSON.stringify(v.alt)}` : ""}`;
      };

      const lines = [
        head +
          (r.status === "submitted"
            ? `submitted by ${r.submittedBy ?? "the client"} on ${r.submittedAt}.`
            : "IN PROGRESS: the client hasn't pressed “I'm done” yet; this is what they did so far (it may change)."),
        "",
      ];
      if (fb.edits.length) {
        lines.push(`Client edits (${fb.edits.length}) — apply each one to the source, where that data-pt key is:`);
        for (const e of fb.edits) lines.push(`- ${e.key} (${e.page}): ${describeValue(e.before)} → ${img(e.value)}`);
        lines.push("");
      }
      if (fb.comments.length) {
        lines.push(`Client notes (${fb.comments.length}) — address each one, then reply to it:`);
        for (const c of fb.comments) {
          const at = c.anchor.key ? `on ${c.anchor.key}` : c.anchor.selector ? `near ${c.anchor.selector}` : `at ${Math.round(c.anchor.x * 100)}% × ${Math.round(c.anchor.y * 100)}% of the page`;
          lines.push(`- note ${c.id} — ${c.page}, ${at} — ${c.author}: ${JSON.stringify(c.text)}`);
        }
        lines.push("");
      }
      lines.push(
        r.status === "submitted"
          ? `Next: apply the edits and notes in the sources (keep keys stable), rebuild, lint, publish with a changelog in the site's language, then call reply with round_id ${r.id} and a reply for every note.`
          : "The round is still open: wait for the client to finish unless the developer wants to act now.",
      );
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "reply",
  {
    title: "Close the review round",
    description:
      "Mark a review round as imported and store a short reply to each client note (in the site's language). The client sees the replies on the link, next to the new version. Call it after publishing the version that addresses the feedback.",
    inputSchema: {
      round_id: z.number().int(),
      replies: z
        .array(z.object({ note_id: z.string(), status: z.enum(["resolved", "answered"]).describe("resolved: you made the change; answered: no change, you explain why"), reply: z.string().max(5000) }))
        .default([]),
      project_dir: z.string().optional(),
    },
  },
  ({ round_id, replies, project_dir }) =>
    guard(async () => {
      const { api } = await linkedProject(project_dir);
      await api.request("POST", `/api/v1/rounds/${round_id}/imported`, {
        replies: Object.fromEntries(replies.map((x) => [x.note_id, { status: x.status, reply: x.reply }])),
      });
      return text(`Round ${round_id} closed with ${replies.length} replies. The client sees them on the link.`);
    }),
);

await server.connect(new StdioServerTransport());
