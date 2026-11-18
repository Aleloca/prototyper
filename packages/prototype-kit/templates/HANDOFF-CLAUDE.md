# {{DEMO_NAME}} — {{CLIENT_NAME}}

This project starts from a prototype approved by the client ({{VERSION}}, exported on {{DATE}}). The design and the copy were agreed with the client page by page; build the real site so that it matches them.

## What is in this pack

- `prototype/`: the approved static prototype. It is the visual reference: open `prototype/index.html` in a browser. It is not production code; rebuild it properly in the chosen stack.
- `HANDOFF.md`: sitemap, page structure, component inventory, technical notes and stack suggestions. Read it first.
- `content.json`: every text, image and link of the prototype, by page and by key. This is the **approved copy**: use it verbatim (or import it into the CMS) unless the client asks for changes.
- `brand/`: brand guidelines (`BRAND.md`), design tokens (`tokens.css`, Tailwind v4 `@theme`) and logo.
- `decisions.md`: the history of the review rounds — what the client asked for and what changed. Check it before "improving" something the client explicitly decided.
- `prototype/assets/`: images used by the prototype. Placeholders (`ph-*.svg`) still need real photos; files in `assets/client/` were provided by the client.

## Rules for building the real site

- Keep the copy, the page structure and the visual hierarchy of the prototype. Deviations need the client's approval.
- Use the tokens in `brand/tokens.css` as the single source for colors, fonts and radii.
- Content language: **{{LANGUAGE}}**.
- Placeholders written in square brackets in the copy (e.g. `[numero di telefono]`) are facts still to be confirmed by the client.
