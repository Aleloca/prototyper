# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Developers at a small agency or freelance studio** who build website prototypes (landing pages, small sites) with Claude Code. They publish and apply feedback from the terminal; the panel is where they check status, copy links and read what the client did.
- **Non-technical teammates** (account managers, project managers, designers) in the same workspaces. They never touch the terminal: they use the panel to follow clients and projects, copy and manage review links, read the client's edits and notes, and see versions.
- **Admins** (usually the studio owner) who also manage people, workspaces and preview domains.
- **Clients never see the panel.** They only see the review link with the overlay.

## Product Purpose

Prototyper turns a prototype into a client review loop: one link where the client edits texts, swaps images and pins notes directly on the page; Claude reads that feedback, applies it and publishes the next version on the same link. The panel is the shared view of that loop for the whole team: what is out, which version the client is looking at, what they changed and asked, what is waiting to be imported.

Success: anyone in the team can answer "where are we with this client?" in seconds, and the team can walk a client through versions and feedback in a meeting without friction.

## Positioning

Built around Claude Code instead of around an editor: projects are created and versions published only through the MCP, never from the panel. Client edits are structured by stable `data-pt` keys, so they land in the source exactly, and notes come back with replies on the same link. Self-hosted and open source (MIT): each team runs its own server and domains.

## Operating Context

- **Desktop, at work**, usually next to the terminal: check review status, copy a link to send, read feedback before asking Claude to apply it.
- **In a meeting with the client** (screen-shared or on a big screen): show versions and their previews at desktop/tablet/mobile widths, go through the client's notes and the replies.
- Mobile use is not a primary scenario, but the panel must remain usable on a phone.
- Content language of prototypes is often Italian; the panel UI is English and Italian.

## Capabilities and Constraints

- Screens: sign-in (password, then TOTP when enabled), invite acceptance, workspace projects grouped by client, project detail (review link controls, versions with live previews, client feedback per round), account (profile, password, 2FA with QR, connected Claude Code computers), admin (people, workspaces, preview domains), MCP consent page.
- The panel reads and manages; it never creates projects or versions.
- Review-link states: open / read-only / disabled; round states: open (waiting or client reviewing) / submitted (feedback to import) / imported.
- Previews are iframes of signed URLs on the preview domain; the panel origin never serves demo content (strict CSP).
- Stack: React 19 + Tailwind v4 SPA (`apps/panel`), served by the Fastify server; English text is the i18n key, Italian dictionary in `src/i18n.tsx`.
- Real-time collaboration, comments by the team inside the panel, analytics: not features today.

## Brand Commitments

- The name **Prototyper** is binding. The current icon and every other visual element may be redesigned.
- Open-source project: the panel is also its public face (README screenshots).

## Evidence on Hand

- No customers, testimonials, metrics or logos exist; never invent them.
- Demo content for screenshots must be fictional (no real client names or personal data).

## Product Principles

1. **Status at a glance**: the review state of every project is the first thing anyone sees.
2. **Readable by non-developers**: plain language, no jargon in labels; technical details (keys, tokens) are secondary.
3. **Presentable**: screens should hold up when shown to a client in a meeting.
4. **The client's work is respected**: their edits and notes are shown faithfully, before → after, with who and when.
5. **Safe by default**: destructive or link-breaking actions are explicit and confirmed.

## Accessibility & Inclusion

No product-specific standard established; aim for WCAG 2.2 AA contrast, full keyboard use and visible focus.
