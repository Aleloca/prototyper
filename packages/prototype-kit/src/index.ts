import { cp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path of the kit's templates folder. Bundlers move this module away from
 * `templates/`, so hosts can point to it with `PROTOTYPER_TEMPLATES_DIR`.
 */
export function templatesDir(): string {
  return process.env.PROTOTYPER_TEMPLATES_DIR ?? fileURLToPath(new URL("../templates/", import.meta.url));
}

export interface DemoVars {
  demoName: string;
  clientName: string;
  /** Language of the visible copy, e.g. "Italian". */
  language: string;
  /** Path of the client's brand folder, relative to the demo folder. */
  brandDir: string;
  brief: string;
  pages: readonly string[];
}

/** Replace `{{NAME}}` placeholders. Unknown placeholders throw, so templates and callers stay in sync. */
export function render(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing template variable ${name}`);
    return value;
  });
}

function templateVars(v: DemoVars): Record<string, string> {
  return {
    DEMO_NAME: v.demoName,
    CLIENT_NAME: v.clientName,
    LANGUAGE: v.language,
    BRAND_DIR: v.brandDir,
    BRIEF: v.brief.trim(),
    PAGES: v.pages.map((p) => `- ${p}`).join("\n"),
  };
}

/** Create a new demo folder from the starter. Fails if `dir` exists and is not empty. */
export async function scaffoldDemo(dir: string, vars: DemoVars): Promise<void> {
  const existing = await readdir(dir).catch(() => []);
  if (existing.length > 0) throw new Error(`Demo folder is not empty: ${dir}`);

  await cp(join(templatesDir(), "starter"), dir, { recursive: true });
  await rename(join(dir, "gitignore"), join(dir, ".gitignore"));

  const tv = templateVars(vars);
  const claudeMd = await readFile(join(templatesDir(), "CLAUDE.md"), "utf8");
  await writeFile(join(dir, "CLAUDE.md"), render(claudeMd, tv));
  const brief = await readFile(join(dir, "brief.md"), "utf8");
  await writeFile(join(dir, "brief.md"), render(brief, tv));
}

/** Appended to Claude Code's system prompt for every Prototyper run. */
export const SYSTEM_PROMPT = `You are working inside a Prototyper demo: a static website prototype for client review.
Follow CLAUDE.md in the working directory exactly, especially the data-pt content contract.
Work only inside the working directory and the directories you were given access to.
Do not run builds, servers or installs: the app builds and previews the site itself.
Finish with a short summary (max 5 bullet points) of what you did, in English.`;

export function generatePrompt(opts: { structureFirst?: boolean } = {}): string {
  if (opts.structureFirst) {
    return `Read brief.md, the brand guidelines and the references (if any).
Do not write any page yet. Propose the structure of the site:
- the sitemap, one line per page;
- for each page, the ordered list of sections with a one-line description of their content and purpose.
Reply with the structure only, as Markdown.`;
  }
  return `Read brief.md, the brand guidelines and the references (if any), then build the whole site in src/:
every page listed in the brief, the SVG placeholders in src/assets/, and src/tokens.css adjusted to the brand if needed.
Respect the data-pt content contract in CLAUDE.md for every visible text and image.`;
}

export function buildFromStructurePrompt(feedback?: string): string {
  return `The structure is approved${feedback?.trim() ? ` with these changes:\n\n${feedback.trim()}\n\n` : ". "}Now build the whole site in src/ following it.
Respect the data-pt content contract in CLAUDE.md for every visible text and image.`;
}

export function lintFixPrompt(report: string): string {
  return `The Prototyper linter found problems in src/. Fix every error (warnings when reasonable) without changing the design or the copy:

${report}

Remember: keep existing keys stable; only add, split or rename keys where the error requires it.`;
}

export function revisionPrompt(round: number, extraInstructions?: string): string {
  const extra = extraInstructions?.trim()
    ? `\n\nAdditional instructions from the developer (they take priority over the notes):\n\n${extraInstructions.trim()}`
    : "";
  return `Client feedback for round ${round} is in .prototyper/rounds/${round}/feedback.md (images referenced there are in the same folder).
The client's direct edits are already applied to src/: treat that copy as approved.
Address every note, then update CHANGELOG.md with a "## v${round + 1}" section and write .prototyper/rounds/${round}/replies.json as described in CLAUDE.md.${extra}`;
}
