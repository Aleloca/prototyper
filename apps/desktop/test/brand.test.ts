import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clusterColors } from "../src/main/brand-extract";
import { parseTokens, updateTokens } from "../src/main/brand";
import { References } from "../src/main/references";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("brand tokens", () => {
  const css = `/* brand */\n@theme {\n  --color-primary: #1f4fd6;\n  --font-heading: "Inter", sans-serif;\n}\n`;

  it("parses and updates values in place, appending missing ones", () => {
    expect(parseTokens(css)).toEqual({ "--color-primary": "#1f4fd6", "--font-heading": '"Inter", sans-serif' });
    const out = updateTokens(css, { "--color-primary": "#ba7517", "--radius-brand": "2px" });
    expect(out).toContain("--color-primary: #ba7517;");
    expect(out).toContain('--font-heading: "Inter", sans-serif;');
    expect(out).toMatch(/--radius-brand: 2px;\n\}/);
    expect(out.startsWith("/* brand */")).toBe(true);
  });

  it("ignores values that could break out of the declaration", () => {
    expect(updateTokens(css, { "--color-primary": "red; } body { display:none" })).toBe(css);
  });
});

describe("clusterColors", () => {
  it("merges near-identical colors and keeps roles", () => {
    const out = clusterColors([
      { hex: "#1f4fd6", weight: 10, roles: { button: 10 } },
      { hex: "#1e4fd5", weight: 5, roles: { link: 5 } },
      { hex: "#ffffff", weight: 100, roles: { background: 100 } },
    ]);
    expect(out).toEqual([
      { hex: "#ffffff", weight: 100, roles: { background: 100 } },
      { hex: "#1f4fd6", weight: 15, roles: { button: 10, link: 5 } },
    ]);
  });
});

describe("References", () => {
  it("adds images with notes and mirrors them into notes.md", async () => {
    dir = await mkdtemp(join(tmpdir(), "pt-refs-"));
    const img = join(dir, "Hero idea.png");
    await writeFile(img, "png");
    const refs = new References(dir);
    await refs.addFile(img, "love this hero");
    await refs.addBuffer(Buffer.from("jpg"), ".jpg", "example.com", "", "https://example.com/");
    await refs.addFile(img);
    expect((await refs.list()).map((r) => r.file)).toEqual(["Hero-idea.png", "example.com.jpg", "Hero-idea-2.png"]);
    await refs.setNote("example.com.jpg", "colors no, layout yes");
    await refs.remove("Hero-idea-2.png");
    const md = await readFile(join(dir, "references", "notes.md"), "utf8");
    expect(md).toContain("## Hero-idea.png\n\nlove this hero");
    expect(md).toContain("## example.com.jpg\n\nScreenshot of https://example.com/\n\ncolors no, layout yes");
    expect(md).not.toContain("Hero-idea-2");
    await expect(refs.addFile(join(dir, "notes.txt"))).rejects.toThrow(/not an image/);
  });
});
