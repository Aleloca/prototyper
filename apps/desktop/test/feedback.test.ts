import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyClientEdits, contentMap, feedbackMarkdown, localizeEdit } from "../src/main/feedback";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SRC = `/s/tok_en-1/__pt/uploads/${ID}`;

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("localizeEdit", () => {
  it("rewrites upload URLs relative to the page", () => {
    const edit = { key: "a.img", value: { kind: "image" as const, src: SRC, alt: "x" } };
    expect(localizeEdit(edit, "index.html").value).toEqual({ kind: "image", src: `assets/client/${ID}.webp`, alt: "x" });
    expect(localizeEdit(edit, "services/web.html").value).toMatchObject({ src: `../assets/client/${ID}.webp` });
    const text = { key: "a.t", value: { kind: "text" as const, text: "hi" } };
    expect(localizeEdit(text, "index.html")).toBe(text);
  });
});

describe("applyClientEdits", () => {
  it("copies uploads and applies edits across pages", async () => {
    dir = await mkdtemp(join(tmpdir(), "pt-fb-"));
    await mkdir(join(dir, "src", "services"), { recursive: true });
    await mkdir(join(dir, "uploads"));
    await writeFile(join(dir, "uploads", `${ID}.webp`), "webp");
    const footer = '<p data-pt="global.footer.note">Old</p>';
    await writeFile(join(dir, "src", "index.html"), `<h1 data-pt="home.hero.title">Hi</h1><img data-pt="global.logo" src="assets/logo.svg" alt="">${footer}`);
    await writeFile(join(dir, "src", "services", "web.html"), `<img data-pt="global.logo" src="../assets/logo.svg" alt="">${footer}`);
    await writeFile(join(dir, "src", "about.html"), "<h1 data-pt=\"about.title\">About</h1>");

    const r = await applyClientEdits(
      dir,
      [
        { key: "home.hero.title", value: { kind: "text", text: "Hello" } },
        { key: "global.logo", value: { kind: "image", src: SRC, alt: "Logo" } },
        { key: "global.footer.note", value: { kind: "text", text: "New" } },
        { key: "gone.key", value: { kind: "text", text: "?" } },
      ],
      join(dir, "uploads"),
    );

    expect(r.changedPages.sort()).toEqual(["index.html", "services/web.html"]);
    expect(r.unmatched).toEqual(["gone.key"]);
    expect(await stat(join(dir, "src", "assets", "client", `${ID}.webp`))).toBeTruthy();
    expect(await readFile(join(dir, "src", "index.html"), "utf8")).toBe(
      `<h1 data-pt="home.hero.title">Hello</h1><img data-pt="global.logo" src="assets/client/${ID}.webp" alt="Logo"><p data-pt="global.footer.note">New</p>`,
    );
    expect(await readFile(join(dir, "src", "services", "web.html"), "utf8")).toContain(`src="../assets/client/${ID}.webp"`);

    const md = feedbackMarkdown({
      versionNumber: 2,
      submittedBy: "Anna",
      submittedAt: "2026-11-18T10:00:00Z",
      applied: [{ key: "home.hero.title", page: "index.html", before: { kind: "text", text: "Hi" }, value: { kind: "text", text: "Hello" }, author: "Anna", updatedAt: "" }],
      notes: [{ id: "n1", page: "index.html", anchor: { key: "home.hero.title", x: 0.5, y: 0.25 }, text: "Bigger?\nMaybe bold", author: "Anna", createdAt: "", screenshotFile: "note-n1.png" }],
      content: await contentMap(dir),
    });
    expect(md).toContain('- `home.hero.title` (index.html): "Hi" → "Hello"');
    expect(md).toContain('- Points at: `home.hero.title` — "Hello" (50% from the left, 25% from the top of it)');
    expect(md).toContain("> Bigger?\n> Maybe bold");
    expect(md).toContain("note-n1.png");
  });
});
