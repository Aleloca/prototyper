import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render, scaffoldDemo } from "../src/index.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("scaffoldDemo", () => {
  it("creates a demo with rendered CLAUDE.md and brief", async () => {
    dir = await mkdtemp(join(tmpdir(), "pt-kit-"));
    const demo = join(dir, "landing");
    await scaffoldDemo(demo, {
      demoName: "Landing 2027",
      clientName: "Acme",
      language: "Italian",
      brandDir: "../../brand",
      brief: "A landing page for a tax advisor.\n",
      pages: ["Home", "Contact"],
    });

    const files = await readdir(demo, { recursive: true });
    expect(files).toEqual(expect.arrayContaining([".gitignore", "CLAUDE.md", "brief.md", "src/styles.css", "src/tokens.css"]));

    const claude = await readFile(join(demo, "CLAUDE.md"), "utf8");
    expect(claude).toContain("# Landing 2027 — Acme");
    expect(claude).toContain("Content language: **Italian**");
    expect(claude).not.toMatch(/\{\{[A-Z_]+\}\}/);

    const brief = await readFile(join(demo, "brief.md"), "utf8");
    expect(brief).toContain("A landing page for a tax advisor.\n\n## Pages\n\n- Home\n- Contact");

    await expect(scaffoldDemo(demo, { demoName: "", clientName: "", language: "", brandDir: "", brief: "", pages: [] })).rejects.toThrow(/not empty/);
  });
});

describe("render", () => {
  it("throws on unknown placeholders", () => {
    expect(() => render("{{NOPE}}", {})).toThrow(/NOPE/);
  });
});
