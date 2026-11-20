---
name: prototyper
description: Publish a website prototype for client review on Prototyper and apply the client's feedback. Use when the user asks to create or update a preview/review link for a client ("creami la preview su Prototyper", "publish this on Prototyper", "share it with the client"), to check whether the client left feedback, edits or notes, or to apply that feedback and publish the next version. Also covers the data-pt attributes that make texts and images editable by the client.
---

# Prototyper

Prototyper hosts a static build of the site on a review link. The client opens it with no account and can **edit texts, replace images and pin notes** on the page, then presses *I'm done*. You read that feedback with the MCP tools, apply it to the sources, and publish the next version on the **same link**, with a changelog and a reply to every note.

Tools (MCP server `prototyper`): `login`, `whoami`, `list_projects`, `link_project`, `lint`, `publish`, `check_feedback`, `reply`.

## Signing in

If a tool says you are not signed in, call `login` with the panel address the user gives you (e.g. `prototyper.example.com`; ask once if you don't know it). It opens the browser: the user enters password and a two-factor code and clicks *Authorize*. Tell the user to complete it in the browser. If `login` returns before they finish, call `whoami` afterwards to confirm.

## Publishing ("create the preview")

1. **Make it editable.** Add the `data-pt` attributes described below to the visible copy and images, in the sources (they must end up in the built HTML). Don't skip this: without keys the client can only leave notes.
2. **Build** the site with the project's own build command (`npm run build`, `astro build`, `vite build`…). Plain HTML projects need no build: publish the folder with `index.html`. The output must be static (no server needed) with `index.html` at its root; for frameworks use static export (e.g. Next `output: "export"`). Use relative or root-relative asset URLs that work under a sub-path: the link is `https://<domain>/s/<token>/`, so prefer **relative** paths (`assets/x.png`, `./about.html`); configure the framework's base path to `./` when it supports it (Vite `base: "./"`, Astro `build.format: "file"` plus relative links).
3. Run `lint` on the build folder and fix errors in the sources.
4. Call `publish` with the build folder. The **first** time it needs `name` (the project), `client` and, if the user is in several workspaces, `workspace` — infer them from the conversation and the repo; ask only if you really can't. It writes `.prototyper.json` in the project root (commit it, so teammates publish to the same project). Later calls publish new versions on the same link.
5. Give the user the link. Don't send it to anyone yourself.

## Applying feedback ("check for changes and apply them")

1. Call `check_feedback`. If the round is still open (the client hasn't pressed *I'm done*), say so and ask whether to apply what's there anyway.
2. **Client edits** are approved content: apply each one exactly, in the source that renders that `data-pt` key (search the sources for the key). Text and links: replace the copy. Rich text: keep only `b strong i em a br`. Images: the tool downloaded them into `.prototyper/feedback/round-N/`; copy each into the project's assets with a sensible name, reference it from the source, update `alt` if given. Don't rewrite edited copy unless a note asks.
3. **Client notes**: address each one (layout, sections, style, questions). If a note asks for something you shouldn't do or conflicts with another, don't change it and explain in the reply.
4. Keep existing keys stable; add keys for new content.
5. Build, `lint`, then `publish` with a short **changelog in the site's language**, written for the client ("New photo of the workshop in the hero", "Added the winter tyres service").
6. Call `reply` with the round id and one reply per note, in the site's language: `resolved` if you made the change, `answered` if you didn't and why. The client sees them on the link next to the new version.
7. Tell the user what you applied, what you answered, and the link.

## The data-pt content contract

Every piece of visible, client-editable content carries a `data-pt` key in the **rendered HTML**:

```html
<h1 data-pt="home.hero.title">Tax advice for business owners</h1>
<p data-pt="home.hero.lead" data-pt-type="rich">At your side for <b>20 years</b>.</p>
<img data-pt="home.hero.image" src="assets/hero.jpg" alt="Our team in the office">
<a data-pt="home.hero.cta" href="contact.html" class="btn">Book a call</a>
<a href="contact.html" class="btn"><span data-pt="home.cta.label">Contact us</span> <svg>…</svg></a>
<section data-pt-bg="home.quote.bg" style="background-image: url('assets/quote.jpg')">…</section>
```

Rules:

1. **Keys**: lowercase, dot-separated, at least two segments: `<page>.<section>.<item>`. Lists use an index: `services.items-1.title`. Shared header/footer content uses `global.`: `global.nav.services`.
2. **One key = one piece of content.** The same key on several pages only when the content is identical (header, footer).
3. **Kinds**: no `data-pt-type` → `<img>` is an image, `<a>` is a link (label + href), anything else plain text. `data-pt-type="rich"` → inline formatting, only `b strong i em a br` inside. `data-pt-bg="key"` → the inline `style` background image is editable (the URL must be in the `style` attribute).
4. **Plain-text and link elements contain only text.** If a button has an icon, put the key on a `<span>` holding the label.
5. **No nesting**: an element with `data-pt` must not contain another one (`data-pt-bg` containers may).
6. Every `<img>` has a key; purely decorative elements (icons, dividers, ©) get `data-pt-ignore`, which also skips their children.
7. **Stable keys across versions**: keep keys for content that still exists; never rename just for style.

In components (React, Vue, Astro…) it's just an attribute: `<h1 data-pt="home.hero.title">{title}</h1>`. For lists, build the key from the index: `` data-pt={`services.items-${i + 1}.title`} ``. Keys must be the same on every build.

## Notes

- Never publish or share without the user asking for it: the link is seen by their client.
- `.prototyper/feedback/` holds downloaded client images; it can be git-ignored.
- `list_projects` shows all projects and their review status; `link_project` links a fresh checkout to an existing project.
