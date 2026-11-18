import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSite, lintSite } from "../src/main/build";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("buildSite", () => {
  it("compiles Tailwind with brand tokens and copies the site", async () => {
    dir = await mkdtemp(join(tmpdir(), "pt-build-"));
    const src = join(dir, "src");
    await mkdir(join(src, "assets"), { recursive: true });
    await writeFile(join(src, "styles.css"), '@import "tailwindcss";\n@import "./tokens.css";\n');
    await writeFile(join(src, "tokens.css"), "@theme { --color-primary: #ff0066; }\n");
    await writeFile(
      join(src, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1 data-pt="home.hero.title" class="text-primary md:text-4xl">Hi</h1><img data-pt="home.hero.image" alt="" src="assets/a.svg"></body></html>',
    );
    await writeFile(join(src, "assets", "a.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

    await buildSite(dir);
    const files = await readdir(join(dir, "dist"), { recursive: true });
    expect(files.sort()).toEqual(["assets", "assets/a.svg", "index.html", "styles.css"]);
    const css = await readFile(join(dir, "dist", "styles.css"), "utf8");
    expect(css).toContain(".text-primary");
    expect(css).toMatch(/--color-primary: #f06/); // lightningcss shortens hex colors
    expect(css).toMatch(/md\\:text-4xl/);

    // Rebuilding replaces dist atomically.
    await buildSite(dir);
    expect((await lintSite(src)).ok).toBe(true);
  });
});
