import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { lintDemo, formatIssues, readSite, type LintResult } from "@prototyper/shared";

/** CSS entry compiled by Tailwind; files only imported by it are not copied to dist. */
const CSS_ENTRY = "styles.css";
const CSS_PARTIALS = new Set(["tokens.css"]);

export async function lintSite(srcDir: string): Promise<LintResult & { report: string }> {
  const site = await readSite(srcDir);
  const result = lintDemo(site);
  return { ...result, report: formatIssues(result.issues) };
}

/** Compile `src/styles.css` with Tailwind v4, scanning `srcDir` for class candidates. */
export async function compileCss(srcDir: string): Promise<string> {
  const input = await readFile(join(srcDir, CSS_ENTRY), "utf8").catch(() => '@import "tailwindcss";');
  const compiler = await compile(input, { base: srcDir, onDependency: () => {} });

  const sources =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: srcDir, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...sources, ...compiler.sources] });
  return optimize(compiler.build(scanner.scan()), { minify: false }).code;
}

/**
 * Build `<demo>/src` into `<demo>/dist`: copy everything except the CSS sources, compile the CSS.
 * The output is assembled in a temp folder and swapped in, so the preview never sees a half-built site.
 */
export async function buildSite(demoDir: string): Promise<void> {
  const srcDir = join(demoDir, "src");
  const distDir = join(demoDir, "dist");
  const tmpDir = join(demoDir, ".prototyper", "build-tmp");

  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await cp(srcDir, tmpDir, {
    recursive: true,
    filter: (from) => {
      const rel = relative(srcDir, from).split(sep).join("/");
      return rel !== CSS_ENTRY && !CSS_PARTIALS.has(rel) && !rel.split("/").some((p) => p.startsWith("."));
    },
  });
  await writeFile(join(tmpDir, CSS_ENTRY), await compileCss(srcDir));

  const oldDir = join(demoDir, ".prototyper", "build-old");
  await rm(oldDir, { recursive: true, force: true });
  await rename(distDir, oldDir).catch(() => {});
  await rename(tmpDir, distDir);
  await rm(oldDir, { recursive: true, force: true });
}
