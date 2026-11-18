import { describe, expect, it } from "vitest";
import { contentInventory, stripContract } from "../src/index.js";

describe("stripContract", () => {
  it("removes contract attributes only", () => {
    const html = '<h1 class="a" data-pt="home.title">Hi</h1>\n<p data-pt="home.lead" data-pt-type="rich" id="x">A <b>b</b></p><div data-pt-ignore>©</div><section data-pt-bg="home.bg" style="background-image:url(a.jpg)"></section><img data-pt="home.img" src="a.jpg" alt="">';
    expect(stripContract(html)).toBe(
      '<h1 class="a">Hi</h1>\n<p id="x">A <b>b</b></p><div>©</div><section style="background-image:url(a.jpg)"></section><img src="a.jpg" alt="">',
    );
  });
});

describe("contentInventory", () => {
  it("lists keys per page in order and content per key", () => {
    const inv = contentInventory([
      { path: "index.html", html: '<title>Home</title><h1 data-pt="home.title">Hi</h1><p data-pt="global.footer">F</p>' },
      { path: "about.html", html: '<title>About</title><h1 data-pt="about.title">About</h1><p data-pt="global.footer">F</p>' },
    ]);
    expect(inv.pages).toEqual([
      { path: "index.html", title: "Home", keys: ["home.title", "global.footer"] },
      { path: "about.html", title: "About", keys: ["about.title", "global.footer"] },
    ]);
    expect(inv.content["global.footer"]).toEqual({ kind: "text", value: { kind: "text", text: "F" }, pages: ["index.html", "about.html"] });
    expect(Object.keys(inv.content)).toEqual(["about.title", "global.footer", "home.title"]);
  });
});
