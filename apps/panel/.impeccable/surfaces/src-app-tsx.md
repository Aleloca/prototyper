---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: Prototyper panel and client overlay

Scope: the whole panel (`apps/panel`: sign-in, invite, projects, project detail, account, admin, MCP consent) and the client review overlay (`packages/overlay`). Mode: Operate.

Audience and job: agency developers and non-technical teammates check where every client review stands, copy and manage links, read the client's edits and notes, and show versions to clients in meetings. Clients use only the overlay: view, edit, comment, "I'm done".

Constraints: light only (no dark default), not decorative; standard web controls; English + Italian; strict CSP (no inline scripts, Google Fonts not allowed on the panel origin: system font stack).

## Direction contract

THESIS: The studio's swatch book. Every client owns a spot colour and every project is a chip in it, with a printed label strip that carries code, version and review state. It refuses the grey SaaS table with coloured status pills.

OWN-WORLD: Paper ground #FAFAF7, white stock, ink #151515, warm greys, hairlines #E6E5DF. Ten spot colours assigned per client (red, process blue, yellow, green, violet, rhodamine, teal, orange, navy, olive), always solid, never gradients. Helvetica Neue / Arial stack; labels at one small size, bold caps tracked; tabular figures. Review states are printed marks: filled dot (feedback to import, amber-brown), half dot (client reviewing), ring (waiting), check ring (imported), struck (link disabled). Ink buttons, square-ish corners (4px).

STORY: Open the panel, see which clients need attention, open a chip, copy the link or read what the client changed and asked, show any version full screen to the client, ask Claude to apply.

FIRST VIEWPORT: Top bar: swatch logo, workspace switcher, Projects/Admin nav, account. Left rail: clients with their chip and counts, then review-state filters with counts. Main: title, one-line summary with the attention count, search and a segmented filter, then a 4-column grid of swatch chips (colour block with code and project name, label strip with state mark, version, activity, time).

FORM: Swatch Book, position 7 of my ordered list; seed:f159f553556ce61c. Signature move: client spot colours as chips across the panel, versions as a fanned swatch deck on the project page, and a meeting mode where one version fills the screen.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
