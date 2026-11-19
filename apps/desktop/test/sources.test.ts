import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagesOf } from "../src/main/assistant";
import { importSource, isSourcePath } from "../src/main/sources";

async function site(root: string): Promise<string> {
  const dir = join(root, "my-site");
  await mkdir(join(dir, "css"), { recursive: true });
  await mkdir(join(dir, "node_modules", "x"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<h1>Hi</h1>");
  await writeFile(join(dir, "chi-siamo.html"), "<h1>Us</h1>");
  await writeFile(join(dir, "css", "style.css"), "h1{color:red}");
  await writeFile(join(dir, "node_modules", "x", "a.js"), "");
  await writeFile(join(dir, ".git", "HEAD"), "");
  await writeFile(join(dir, ".DS_Store"), "");
  return dir;
}

describe("importSource", () => {
  it("copies a folder without dependencies, VCS and junk", async () => {
    const root = await mkdtemp(join(tmpdir(), "pt-src-"));
    const dir = await site(root);
    await symlink("/etc/passwd", join(dir, "link.html"));
    const src = await importSource([dir], join(root, "out"));
    expect(src.files).toEqual(["chi-siamo.html", "css/style.css", "index.html"]);
    expect(await readFile(join(src.dir, "css", "style.css"), "utf8")).toBe("h1{color:red}");
    expect(pagesOf(src)).toEqual(["Home", "Chi siamo"]);
  });

  it.skipIf(process.platform !== "darwin")("extracts a zip and unwraps its single top folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "pt-src-"));
    const dir = await site(root);
    const zip = join(root, "site.zip");
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", dir, zip]);
    expect(await isSourcePath(zip)).toBe(true);
    const src = await importSource([zip], join(root, "out"));
    expect(src.files).toContain("index.html");
    expect(src.files).toContain("css/style.css");
    expect(src.files.some((f) => f.startsWith("node_modules") || f.startsWith(".git"))).toBe(false);
  });

  it("gathers loose files and refuses sources without HTML", async () => {
    const root = await mkdtemp(join(tmpdir(), "pt-src-"));
    const dir = await site(root);
    const src = await importSource([join(dir, "index.html"), join(dir, "css", "style.css")], join(root, "out"));
    expect(src.files).toEqual(["index.html", "style.css"]);
    await expect(importSource([join(dir, "css")], join(root, "out2"))).rejects.toThrow(/No HTML/);
    expect(await isSourcePath(join(dir, "css", "style.css"))).toBe(false);
  });
});
