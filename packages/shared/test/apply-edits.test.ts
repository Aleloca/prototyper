import { describe, expect, it } from "vitest";
import { applyEdits, applyEditsToDemo } from "../src/index.js";

const page = `<!doctype html>
<html lang="en">
<head><title>Acme</title></head>
<body>
  <header>
    <a data-pt="global.nav.contact" href="contact.html">Contact us</a>
  </header>
  <section data-pt-bg="home.hero.bg" class="hero" style="padding: 2rem; background-image: url('assets/hero.jpg')">
    <h1 class="text-4xl"
        data-pt="home.hero.title">
      Tax advice for
      business owners
    </h1>
    <p data-pt="home.hero.lead" data-pt-type="rich">For <b>20 years</b> at your side.</p>
    <img data-pt="home.hero.image" src="assets/a.jpg" srcset="assets/a@2x.jpg 2x" alt="Office">
    <img data-pt="home.team.image" src="assets/b.jpg"/>
  </section>
</body>
</html>
`;

describe("applyEdits", () => {
  it("leaves the document untouched without edits", () => {
    expect(applyEdits(page, []).html).toBe(page);
  });

  it("replaces plain text and escapes it", () => {
    const r = applyEdits(page, [{ key: "home.hero.title", value: { kind: "text", text: "Fees <fair> & clear" } }]);
    expect(r.html).toContain('data-pt="home.hero.title">Fees &lt;fair&gt; &amp; clear</h1>');
    expect([...r.applied]).toEqual(["home.hero.title"]);
    // Only the inner range changed.
    expect(r.html.replace(/>Fees[^<]*</, ">X<")).toBe(page.replace(/>\s*Tax advice[^<]*</, ">X<"));
  });

  it("sanitizes rich text", () => {
    const r = applyEdits(page, [
      {
        key: "home.hero.lead",
        value: { kind: "rich", html: 'Now <strong>30</strong> years<script>alert(1)</script> <a href="javascript:x">bad</a> <div>ok</div>' },
      },
    ]);
    expect(r.html).toContain('data-pt-type="rich">Now <strong>30</strong> years bad ok</p>');
  });

  it("updates link label and href", () => {
    const r = applyEdits(page, [{ key: "global.nav.contact", value: { kind: "link", label: "Write to us", href: "mailto:a@b.it" } }]);
    expect(r.html).toContain('<a data-pt="global.nav.contact" href="mailto:a@b.it">Write to us</a>');
  });

  it("replaces image src, drops srcset, sets alt", () => {
    const r = applyEdits(page, [
      { key: "home.hero.image", value: { kind: "image", src: "assets/new.jpg", alt: 'New "office"' } },
      { key: "home.team.image", value: { kind: "image", src: "assets/team.webp", alt: "Team" } },
    ]);
    expect(r.html).toContain('<img data-pt="home.hero.image" src="assets/new.jpg" alt="New &quot;office&quot;">');
    expect(r.html).toContain('<img data-pt="home.team.image" src="assets/team.webp" alt="Team"/>');
  });

  it("replaces a background image url and keeps other styles", () => {
    const r = applyEdits(page, [{ key: "home.hero.bg", value: { kind: "bg", src: "assets/bg2.jpg" } }]);
    expect(r.html).toContain('style="padding: 2rem; background-image: url(&quot;assets/bg2.jpg&quot;)"');
  });

  it("reports kind mismatches instead of applying them", () => {
    const r = applyEdits(page, [{ key: "home.hero.image", value: { kind: "text", text: "x" } }]);
    expect(r.html).toBe(page);
    expect(r.conflicts).toMatchObject([{ key: "home.hero.image", reason: "kind-mismatch" }]);
  });

  it("refuses nested keys rather than corrupting the document", () => {
    const html = '<div data-pt="a.outer" data-pt-type="rich">x <span data-pt="a.inner">y</span></div>';
    const r = applyEdits(html, [
      { key: "a.outer", value: { kind: "rich", html: "new" } },
      { key: "a.inner", value: { kind: "text", text: "z" } },
    ]);
    expect(r.conflicts.map((c) => c.reason)).toEqual(["nested"]);
    expect(r.applied.size).toBe(1);
  });
});

describe("applyEditsToDemo", () => {
  it("applies demo-wide keys to every page and reports unmatched keys", () => {
    const a = { path: "index.html", html: '<footer><p data-pt="global.footer.note">Old</p></footer>' };
    const b = { path: "about.html", html: '<footer><p data-pt="global.footer.note">Old</p></footer><h1 data-pt="about.title">About</h1>' };
    const r = applyEditsToDemo(
      [a, b],
      [
        { key: "global.footer.note", value: { kind: "text", text: "New" } },
        { key: "home.gone.title", value: { kind: "text", text: "?" } },
      ],
    );
    expect(r.changed.map((p) => p.path)).toEqual(["index.html", "about.html"]);
    expect(r.changed.every((p) => p.html.includes(">New</p>"))).toBe(true);
    expect(r.unmatched).toEqual(["home.gone.title"]);
  });
});
