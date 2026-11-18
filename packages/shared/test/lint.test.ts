import { describe, expect, it } from "vitest";
import { lintDemo, resolveLocal } from "../src/index.js";

const doc = (body: string) => `<!doctype html><html><head><title>T</title><style>.a{}</style></head><body>${body}</body></html>`;
const rules = (body: string, assets?: string[]) =>
  lintDemo({ pages: [{ path: "index.html", html: doc(body) }], ...(assets ? { assets } : {}) }).issues.map((i) => i.rule);

describe("lintDemo", () => {
  it("accepts a well-formed page and extracts content", () => {
    const r = lintDemo({
      pages: [
        {
          path: "index.html",
          html: doc(`
            <nav><a href="about.html"><span data-pt="global.nav.about">About</span> <svg><text>icon</text></svg></a></nav>
            <h1 data-pt="home.hero.title">Hello</h1>
            <p data-pt="home.hero.lead" data-pt-type="rich">With <b>love</b></p>
            <img data-pt="home.hero.image" src="assets/a.jpg" alt="A">
            <div data-pt-ignore>© 2026</div>
            <script>const s = "not copy";</script>`),
        },
        { path: "about.html", html: doc('<a data-pt="global.nav.home" href="./">Home</a>') },
      ],
      assets: ["assets/a.jpg"],
    });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.content.get("home.hero.lead")?.value).toEqual({ kind: "rich", html: "With <b>love</b>" });
    expect(r.content.get("global.nav.home")?.value).toEqual({ kind: "link", label: "Home", href: "./" });
  });

  it("flags visible text without a key", () => {
    expect(rules("<section><h2>Orphan title</h2></section>")).toEqual(["missing-key"]);
  });

  it("ignores punctuation-only text", () => {
    expect(rules('<p data-pt="a.b">x</p> · → | 2026')).toEqual([]);
  });

  it("flags images without a key and missing alt", () => {
    expect(rules('<img src="a.jpg"><img data-pt="a.img" src="a.jpg">')).toEqual(["image-missing-key", "missing-alt"]);
  });

  it("flags markup inside plain text and links", () => {
    expect(rules('<p data-pt="a.text">Hi <b>there</b></p><a data-pt="a.link" href="#"><i>x</i> Go</a>')).toEqual([
      "text-has-markup",
      "link-has-markup",
    ]);
  });

  it("flags nested keys", () => {
    expect(rules('<div data-pt="a.outer" data-pt-type="rich">x <span data-pt="a.inner">y</span></div>')).toContain("nested-key");
  });

  it("allows keys inside a data-pt-bg section", () => {
    expect(rules(`<section data-pt-bg="a.bg" style="background-image:url(a.jpg)"><h2 data-pt="a.title">T</h2></section>`)).toEqual([]);
  });

  it("flags data-pt-bg without a url", () => {
    expect(rules('<section data-pt-bg="a.bg" class="bg-red-500"></section>')).toEqual(["bg-missing-url"]);
  });

  it("flags invalid keys and types", () => {
    expect(rules('<p data-pt="Hero">x</p><p data-pt="a.b" data-pt-type="video">y</p><div data-pt="a.pic" data-pt-type="image"></div>')).toEqual([
      "invalid-key",
      "invalid-type",
      "image-not-img",
    ]);
  });

  it("flags implied end tags", () => {
    expect(rules('<ul><li data-pt="a.one">One<li data-pt="a.two">Two</ul>')).toEqual(["no-end-tag", "no-end-tag"]);
  });

  it("flags reused keys with different content across pages", () => {
    const r = lintDemo({
      pages: [
        { path: "index.html", html: doc('<p data-pt="global.footer.note">One</p>') },
        { path: "about.html", html: doc('<p data-pt="global.footer.note">Two</p>') },
        { path: "x.html", html: doc('<p data-pt="global.footer.note">One</p>') },
      ],
    });
    expect(r.issues).toMatchObject([{ rule: "key-conflict", page: "about.html" }]);
  });

  it("flags broken internal links and missing assets", () => {
    expect(rules('<a data-pt="a.l" href="services.html#x">S</a><a data-pt="a.m" href="https://x.it">X</a>')).toEqual(["broken-link"]);
    expect(rules('<img data-pt="a.i" alt="" src="assets/missing.png">', ["assets/a.jpg"])).toEqual(["missing-asset"]);
  });
});

describe("resolveLocal", () => {
  it.each([
    ["index.html", "about.html", "about.html"],
    ["blog/post.html", "../index.html", "index.html"],
    ["blog/post.html", "/assets/a.jpg", "assets/a.jpg"],
    ["blog/post.html", "./", "blog/index.html"],
    ["index.html", "contact.html?x=1#form", "contact.html"],
    ["index.html", "#top", undefined],
    ["index.html", "mailto:a@b.it", undefined],
    ["index.html", "//cdn.example.com/x.js", undefined],
  ])("%s + %s → %s", (from, url, expected) => {
    expect(resolveLocal(from, url)).toBe(expected);
  });
});
