import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { renderHandoffClaudeMd } from "@prototyper/prototype-kit";
import { contentInventory, readSite, stripContract } from "@prototyper/shared";
import type { DemoMeta, ExportOptions } from "../common/types";

const execFileAsync = promisify(execFile);

export interface ExportSources {
  demoDir: string;
  brandDir: string;
  meta: DemoMeta;
  clientName: string;
  /** Path of a HANDOFF.md written by Claude, if any. */
  handoffDoc?: string;
}

/** Copy a built site, removing the contract attributes from HTML pages when asked. */
async function copySite(distDir: string, outDir: string, strip: boolean): Promise<void> {
  await cp(distDir, outDir, { recursive: true });
  if (!strip) return;
  const site = await readSite(outDir);
  for (const page of site.pages) await writeFile(join(outDir, page.path), stripContract(page.html));
}

/** History of the review rounds, for the developers: changelog, client feedback and replies. */
export async function decisionsMarkdown(demoDir: string, meta: DemoMeta): Promise<string> {
  const lines = [`# Decisions — ${meta.name}`, "", "How the prototype evolved with the client, round by round.", "", "## Versions", ""];
  for (const v of meta.versions) lines.push(`- **v${v.number}** (${v.createdAt.slice(0, 10)}): ${v.summary}`);
  const changelog = await readFile(join(demoDir, "CHANGELOG.md"), "utf8").catch(() => "");
  if (changelog.replace(/^#.*$/m, "").trim()) lines.push("", "## Changelog shown to the client", "", changelog.replace(/^# .*\n/, "").replace(/^## /gm, "### ").trim());

  const roundsDir = join(demoDir, ".prototyper", "rounds");
  const rounds = (await readdir(roundsDir).catch(() => [] as string[])).filter((d) => /^v\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  for (const r of rounds) {
    const feedback = await readFile(join(roundsDir, r, "feedback.md"), "utf8").catch(() => "");
    if (!feedback) continue;
    lines.push("", `## Client review of ${r}`, "", feedback.replace(/^# .*\n/, "").replace(/^(#+) /gm, "##$1 ").trim());
    const replies = await readFile(join(roundsDir, r, "replies.json"), "utf8").then((t) => JSON.parse(t) as Record<string, { status: string; reply?: string }>, () => ({}));
    const entries = Object.entries(replies);
    if (entries.length) {
      lines.push("", "#### Replies sent to the client", "");
      for (const [id, rep] of entries) lines.push(`- \`${id}\` (${rep.status}): ${rep.reply ?? ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Assemble the export in a temp folder and zip it to `zipPath` (macOS `ditto`). */
export async function exportZip(src: ExportSources, opts: ExportOptions, zipPath: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "prototyper-export-"));
  const root = join(tmp, basename(zipPath, ".zip"));
  try {
    const dist = join(src.demoDir, "dist");
    if (opts.kind === "site") {
      await copySite(dist, root, opts.stripKeys);
    } else {
      await mkdir(root, { recursive: true });
      await copySite(dist, join(root, "prototype"), opts.stripKeys);

      const site = await readSite(join(src.demoDir, "src"));
      await writeFile(join(root, "content.json"), JSON.stringify(contentInventory(site.pages), null, 2));

      await mkdir(join(root, "brand"), { recursive: true });
      for (const f of await readdir(src.brandDir).catch(() => [] as string[])) {
        if (f === "BRAND.md" || /^logo\./.test(f)) await cp(join(src.brandDir, f), join(root, "brand", f));
      }
      // The demo's tokens are what the approved prototype actually uses (Claude may have adjusted the client's).
      await cp(join(src.demoDir, "src", "tokens.css"), join(root, "brand", "tokens.css")).catch(() => {});

      await writeFile(join(root, "decisions.md"), await decisionsMarkdown(src.demoDir, src.meta));
      const version = src.meta.versions.at(-1)?.number ?? 0;
      await writeFile(
        join(root, "CLAUDE.md"),
        await renderHandoffClaudeMd({ demoName: src.meta.name, clientName: src.clientName, language: src.meta.language, version, date: new Date().toISOString().slice(0, 10) }),
      );
      if (src.handoffDoc) await cp(src.handoffDoc, join(root, "HANDOFF.md"));
      await cp(join(src.demoDir, "brief.md"), join(root, "brief.md")).catch(() => {});
    }
    await mkdir(join(zipPath, ".."), { recursive: true });
    await rm(zipPath, { force: true });
    // No resource forks, extended attributes or ACLs: they become "._*" junk files on other systems.
    await execFileAsync("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noacl", "--keepParent", root, zipPath]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
