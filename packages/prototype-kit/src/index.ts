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

/**
 * Prompt for the next version after a client review round.
 * @param roundDir  folder with feedback.md, relative to the demo (e.g. `.prototyper/rounds/v2`)
 * @param nextVersion  the version Claude is producing
 */
export function revisionPrompt(roundDir: string, nextVersion: number, extraInstructions?: string): string {
  const extra = extraInstructions?.trim()
    ? `\n\nAdditional instructions from the developer (they take priority over the notes):\n\n${extraInstructions.trim()}`
    : "";
  return `Client feedback is in ${roundDir}/feedback.md (images and screenshots referenced there are in the same folder; look at them).
The client's direct text and image edits are already applied to src/: treat that copy as approved.
Address every note, then:
- prepend a "## v${nextVersion}" section to CHANGELOG.md: a short, client-friendly list of what changed, in the content language;
- write ${roundDir}/replies.json as described in CLAUDE.md, with one entry for every note id.${extra}`;
}

/** Token names every brand defines; the starter's tokens.css and the brand editor use the same set. */
export const BRAND_TOKENS = [
  "--color-primary",
  "--color-primary-contrast",
  "--color-accent",
  "--color-ink",
  "--color-muted",
  "--color-surface",
  "--color-surface-alt",
  "--color-line",
  "--font-heading",
  "--font-body",
  "--radius-brand",
] as const;

/** Prompt for turning raw data extracted from a client's website into brand guidelines. */
export function brandPrompt(clientName: string, website: string): string {
  return `You are in the brand folder of the client "${clientName}" (${website}).
brand.json holds design data extracted from their live website: colors weighted by how much they are used and in which role, fonts, buttons, radii, shadows, logo, and samples of their copy. screenshots/ holds desktop and mobile screenshots. Look at the screenshots: they matter more than the numbers.

Write two files here:

1. BRAND.md — concise, practical guidelines a designer would use to build new pages that clearly belong to this brand:
   - Palette: each color with hex and its role (primary, accent, text, muted text, surfaces, lines), plus how they are combined.
   - Typography: heading and body fonts, weights, scale, case and spacing habits. If a font is not on Google Fonts, pick the closest Google Font and say so. End the section with the exact <link> tag that loads the fonts from Google Fonts.
   - Shapes and components: radii, shadows, button styles, how cards and sections look, imagery style.
   - Tone of voice, from their copy: formal or informal, "tu" or "lei"/"voi" for Italian, typical phrases, what to avoid.
   - Logo: which file in this folder is the logo (logo.svg / logo.png…), and on which backgrounds it works.
   - Don'ts.
2. tokens.css — a Tailwind v4 @theme block defining exactly these variables (keep the names, choose the values from the brand):
${BRAND_TOKENS.map((t) => `   ${t}`).join("\n")}
   --color-primary-contrast is the text color on primary backgrounds. Font variables are full font-family stacks.

Don't create other files. Finish with a two-line summary.`;
}

/** CLAUDE.md for the real project, shipped in the handoff pack. */
export async function renderHandoffClaudeMd(vars: { demoName: string; clientName: string; language: string; version: number; date: string }): Promise<string> {
  const tpl = await readFile(join(templatesDir(), "HANDOFF-CLAUDE.md"), "utf8");
  return render(tpl, {
    DEMO_NAME: vars.demoName,
    CLIENT_NAME: vars.clientName,
    LANGUAGE: vars.language,
    VERSION: `v${vars.version}`,
    DATE: vars.date,
  });
}

/** Prompt for the developer handoff document, written from the demo's own folder. */
export function handoffPrompt(outFile: string): string {
  return `The client approved this prototype. Write ${outFile}: a handoff document for the developers who will build the real site from it. Read src/, CHANGELOG.md, brief.md and the brand guidelines first. Write it in English, concise and practical:

1. Overview: what the site is for, audience, main goal and conversion action.
2. Sitemap: every page with its purpose.
3. Page by page: the sections in order, what each contains, interactive behaviour (menus, accordions, forms).
4. Component inventory: reusable components (header, footer, cards, buttons, forms…) and their variants.
5. Content: which texts and images are still placeholders or facts to confirm (look for [square brackets] and ph-*.svg images).
6. Forms and integrations needed (form handling, maps, analytics, cookie consent…).
7. Technical notes: accessibility, responsive behaviour, SEO basics (titles, descriptions), performance.
8. Suggested stack for a site of this size, with one sentence of reasoning, and anything that would change the suggestion.

Only write that file. Don't change anything in src/.`;
}
