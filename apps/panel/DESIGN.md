---
name: Prototyper
description: The studio's swatch book, where every client is a spot colour and every project a chip.
colors:
  paper: "#fafaf7"
  stock: "#ffffff"
  ink: "#151515"
  ink-2: "#3a3a36"
  muted: "#5f5e58"
  faint: "#72716a"
  line: "#e6e5df"
  line-strong: "#d6d5cd"
  wash: "#f2f1ec"
  attention: "#a85a12"
  attention-wash: "#fbf0e2"
  reviewing: "#1f6f99"
  reviewing-wash: "#e7f1f7"
  done: "#2b7a4b"
  done-wash: "#e6f2ea"
  danger: "#b8322a"
  danger-wash: "#fbebe9"
  focus: "#2e86ab"
  spot-warm-red: "#c84c28"
  spot-process-blue: "#2b7da0"
  spot-yellow: "#f2c14e"
  spot-green: "#32835a"
  spot-violet: "#6e56a8"
  spot-rhodamine: "#c94279"
  spot-teal: "#138378"
  spot-orange: "#f28c28"
  spot-navy: "#2b3a67"
  spot-olive: "#6e7b2f"
  spot-neutral: "#d6d5cd"
  overlay-pin: "#c84c28"
typography:
  display:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  chip-title:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  body:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.45
  caption:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.08em"
    fontFeature: "\"tnum\""
rounded:
  hairline: "2px"
  chip: "3px"
  control: "4px"
  floating: "6px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "28px"
  3xl: "32px"
components:
  button:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.wash}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  button-danger:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.danger-wash}"
  button-sm:
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  segmented:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "2px"
  segmented-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    rounded: "{rounded.chip}"
  sheet:
    backgroundColor: "{colors.stock}"
    rounded: "{rounded.control}"
    padding: "24px"
  swatch-chip:
    backgroundColor: "{colors.stock}"
    rounded: "{rounded.chip}"
    width: "232px"
  swatch-chip-colour-block:
    typography: "{typography.chip-title}"
    padding: "16px"
    height: "148px"
  tag:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.hairline}"
    padding: "0 6px"
    height: "22px"
  tag-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
  modal:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.floating}"
  top-bar:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.muted}"
    height: "56px"
---

# Design System: Prototyper

## Overview

**Creative North Star: "The Studio Swatch Book"**

The panel is a printer's swatch book for a small studio. Every client owns one solid spot colour, assigned by the server from a ten-ink palette and distinct within a workspace, and every project is a chip cut from that colour: a coloured block carrying the swatch code and project name, above a white label strip that prints the review state, version, activity and time. The ground is uncoated paper, the cards are white stock, the type is black ink. Colour means *who*; printed marks mean *where the review stands*. The two never trade jobs.

Density is calm and operational. Helvetica Neue in bold, tight headlines and one small tracked caps label size give it the feel of printed production paperwork rather than a SaaS dashboard. Depth is a paper stack: chips sit on the paper with a hairline shadow and lift a few pixels when touched. The system refuses the grey SaaS table with coloured status pills: status is a printed mark next to words, never a filled pill and never the chip's colour.

The same world reaches the client review overlay (`packages/overlay`): ink toolbar segments, white floating cards, the same hairlines, radii and focus colour, so the client and the studio see one material.

**Key Characteristics:**
- Paper ground, white stock, warm-grey hairlines, near-black ink.
- One solid spot colour per client, never a gradient, never a status signal.
- Review states as printed SVG marks (filled, half, ring, check ring, dashed ring, struck) paired with caps words.
- One label size: 11px bold caps, tracked 0.08em, tabular figures.
- Square-ish corners (2 to 6px) and ink-filled primary actions.
- Light only.

## Colors

A neutral paper-and-ink base carries ten saturated printing inks that belong to clients, plus four muted state hues reserved for marks and their words.

### Primary
- **Press Ink** (ink): the primary action colour, the selected segment, the active tab rule, the avatar block, the rivet on the version fan, and all body text. Primary buttons are ink-filled; there is no brand accent hue in the chrome.

### Secondary: client spot inks
Ten solid inks, indexed by the server per client (`swatch.ts`), each with its legible text colour (white, except Yellow and Orange which take ink). All white-on-spot pairs were deepened to pass AA at 4.5:1.
- **Warm Red** (spot-warm-red), **Process Blue** (spot-process-blue), **Yellow** (spot-yellow, ink text), **Green** (spot-green), **Violet** (spot-violet), **Rhodamine** (spot-rhodamine), **Teal** (spot-teal), **Orange** (spot-orange, ink text), **Navy** (spot-navy), **Olive** (spot-olive).
- **Unassigned Grey** (spot-neutral): the chip for a project with no client index, ink text.
- Spot inks appear on: the colour block of a project chip, the large version chip on the project page, the version fan leaves, the 14px client chip in the client rail and filters, and the four-chip logo (Warm Red, Yellow, Process Blue, Green). Selection highlight uses Yellow.

### Tertiary: review-state hues
Used only for a state mark, the words beside it, and the matching wash behind a tag or notice.
- **Burnt Amber** (attention / attention-wash): feedback to import; the one state that needs the team.
- **Reviewing Blue** (reviewing / reviewing-wash): the client is working on the link.
- **Imported Green** (done / done-wash): feedback imported, copy confirmed.
- **Signal Red** (danger / danger-wash): destructive actions and errors.
- **Focus Blue** (focus): the 2px focus outline, input focus halo at 18% alpha, and the overlay's editable-content outlines.

### Neutral
- **Uncoated Paper** (paper): the page ground, modal footers, meeting mode ground.
- **White Stock** (stock): chips, sheets, inputs, buttons, top bar.
- **Second Ink** (ink-2): primary-button hover, label text in forms, neutral tag text.
- **Warm Grey** (muted): secondary text, inactive nav and tabs, metadata.
- **Pale Grey** (faint): the struck and dashed marks, empty-state hints. Meta text such as counts and times; it holds 4.69:1 on paper.
- **Hairline** (line): dividers, tab baselines, modal header and footer rules.
- **Strong Hairline** (line-strong): control borders, scrollbar thumbs, spinner track.
- **Wash** (wash): button hover, neutral tags, quoted prompts, overlay segment ground.

### Named Rules
**The Colour Is Who Rule.** A spot colour identifies a client and nothing else. Never tint a chip by review state, and never use a spot ink for a status, an action, or a chart series.

**The Solid Ink Rule.** Spot colours are printed flat: no gradients, no transparency, no tints on the chip itself.

**The Ink Button Rule.** The primary action is ink on white. State hues never fill a primary button; only `danger` may fill, and only to confirm destruction.

## Typography

**Display Font:** Helvetica Neue (with Helvetica, Arial, system-ui)
**Body Font:** the same stack
**Label Font:** the same stack, as bold tracked caps

**Character:** One neo-grotesque throughout, used like production paperwork: tight bold headlines with negative tracking, plain regular body, and small bold caps for every label. The stack is a constraint of the panel's strict CSP (no web fonts on the panel origin).

### Hierarchy
- **Display** (700, 28px, tight leading, -0.02em): the project name on the project page.
- **Headline** (700, 26px, -0.02em): page titles (Projects, Account, Admin); 22px on the sign-in sheet.
- **Chip Title** (700, 19px, 1.15, -0.015em): project name inside the chip's colour block, clamped to two lines.
- **Title** (700, 16 to 17px, -0.01em): section sheets, modal titles, the logotype, meeting-mode project name.
- **Body** (400, 14px, 1.45): default text. Secondary text drops to 13.5px weight 500 for controls and metadata; 12.5px for chip label strips. Descriptions cap at 56 to 62ch.
- **Caption** (400, 12.5px): meta lines on chips and lists (activity, times, connection details), the hostname of a domain, small hints.
- **Label** (700, 11px, 0.08em, uppercase): swatch codes, state labels, section subheads, rail headings, reply labels. Tags print the same caps.

### Named Rules
**The One Label Size Rule.** Labels are 11px bold caps tracked 0.08em. Rank between labels comes from colour and position, never from a second label size.

**The Tabular Rule.** Every number that can change (counts, versions, swatch codes, times) is set with tabular figures.

## Layout

A centred column at 1320px max, 32px side gutters (16px on phones). The workspace screen is a two-column grid: a 220px sticky client rail (clients with chip and count) and the main column (title, one-line summary, search, a segmented review-state filter, then the chip grid). Below `lg` the rail becomes a horizontally scrolling row of client buttons above the grid.

The chip grid auto-fills columns of at least 232px with 20px gaps, landing at four columns on a desktop. Stacked page sections are separated by 28px; sheets pad 24px (28px for sign-in). The top bar is 56px, sticky, white, with a hairline under it; on phones its nav moves to a second row.

The project page opens with a 104px-wide spot chip printing the swatch code and the version number, beside the client name, project name and state label. Versions sit on a fan deck; meeting mode takes the whole viewport with a white header strip and the preview filling the paper.

## Elevation & Depth

A paper stack. Surfaces are flat white stock separated from the paper by a hairline-plus-ambient shadow; lift is reserved for interaction and for floating layers. Shadows are soft and ink-tinted, never hard or offset.

### Shadow Vocabulary
- **Chip** (`0 1px 2px rgb(21 21 21 / 0.06), 0 0 0 1px rgb(21 21 21 / 0.07)`): chips, sheets, the project-page spot chip, resting fan leaves. The 1px ring stands in for a border.
- **Lift** (`0 10px 24px -8px rgb(21 21 21 / 0.22), 0 0 0 1px rgb(21 21 21 / 0.08)`): a chip under hover or focus (with a 2px rise), the selected fan leaf.
- **Pop** (`0 18px 40px -12px rgb(21 21 21 / 0.28), 0 0 0 1px rgb(21 21 21 / 0.08)`): modals, the overlay toolbar, popovers, drawer, toasts.

### Named Rules
**The Paper Stack Rule.** At rest everything sits one sheet high. Only touch (hover, focus, selection) lifts a chip, and only floating layers use Pop.

## Shapes

Square-ish, cut-paper corners on a tight four-step scale: 2px for tags and the 14px client chip, 3px for swatch chips, fan leaves and segment buttons, 4px for buttons, inputs, sheets and notices, 6px for floating layers (modals, overlay toolbar, cards). Full circles appear only in printed marks, the rivet, spinners and overlay pins. Borders are 1px hairlines; chips use the shadow ring instead of a border. Empty states use a 1px dashed strong hairline.

## Components

### Buttons
Quiet white keys with an ink key for the one main action.
- **Shape:** gently squared (4px), 36px tall, 14px side padding, 13.5px medium text, 16px icon with 8px gap.
- **Default:** white stock, strong-hairline border, ink text. Hover: wash fill and a darker border; active: hairline fill.
- **Primary:** ink fill and border, white text; hover to Second Ink.
- **Danger:** white with danger text and a 35% danger border; hover fills danger-wash. **Danger solid** fills danger, only in a confirm step.
- **Ghost:** no border or fill; hover adds a 5% ink tint. Used for icon-only close and sign-out.
- **Small:** 32px tall, 10px padding, 13px text.
- **Disabled:** 45% opacity, no pointer events. Transitions run 150ms on colour, border and shadow.

### Segmented Filter
- **Style:** white track with a strong hairline and 2px inset; segments are 3px-cornered 13px medium muted text.
- **Selected:** ink fill, white text; a segment's mark turns white and its count drops to 70% white.
- Each review-state segment prints its mark, its words and a tabular count.

### Tabs
Medium 14px muted text over a hairline baseline, 24px apart; the selected tab is ink with a 2px ink underline. A pending-feedback tab carries the attention mark.

### Inputs / Fields
- **Style:** white stock, strong-hairline border, 4px corners, 40px tall, 12px padding, 14px text, faint placeholder; search inputs inset a 16px icon.
- **Hover:** border darkens to 35% ink.
- **Focus:** ink border plus a 3px Focus Blue halo at 18%.
- **Labels:** 13px medium Second Ink, 6px above the field. Errors print as 13px medium danger text with `role="alert"`.

### Sheets / Containers
- **Corner Style:** 4px (6px when floating).
- **Background:** white stock on paper.
- **Shadow Strategy:** Chip shadow; see Elevation & Depth.
- **Internal Padding:** 24px; section title at 16px bold with an optional muted description.

### Tags
Small printed tags for roles and account states (Admin, 2FA, Invite pending): label caps at 11px, 22px tall, 2px corners, 6px padding, on a tone wash (neutral, ink, done, attention, reviewing, danger). Tags name attributes; review state on a project is always a mark, never a tag.

### Navigation
A 56px white top bar: the four-chip logo and bold "Prototyper", a workspace select, text nav (14px medium, muted, ink with a 2px ink underline when active), and an account button with an ink initials block. The client rail lists clients as 14px rows with their 14px chip and a tabular count; the active row gets a 6% ink tint and semibold text.

### Swatch Chip (signature)
The project card. A 148px colour block in the client's spot ink prints the swatch code (client initials and a three-digit project number, e.g. `OV·003`) and version in label caps at the top, then the client name and the project name (Chip Title) at the bottom. Below it a white label strip prints the state label (mark plus caps words), activity and relative time. 3px corners, Chip shadow; hover or keyboard focus lifts 2px into Lift over 200ms ease-out. The whole chip is one link, with a copy-link button above it.

### State Mark (signature)
An 11px SVG printed mark, 1.5px stroke, coloured by state: **filled dot** in Burnt Amber (feedback to import), **half dot** in Reviewing Blue (client reviewing), **ring** in ink (waiting for the client), **check ring** in Imported Green (feedback imported), **dashed ring** in faint (not published), **struck ring** in faint with struck words (link disabled). Always paired with caps words, 8px apart.

### Version Fan (signature)
Versions as a riveted fan deck: 62 by 112px leaves, oldest at the back, each a white strip with the tabular `vN` over the client's spot ink, rotated up to 13 degrees apart around a bottom-left pivot. An 11px ink rivet with a white ring holds the deck. The selected leaf swings out 14px with the Lift shadow over 300ms `cubic-bezier(.2,.8,.2,1)`. It is a keyboard listbox.

### Meeting Mode
A full-viewport native dialog on paper: a white header strip with client and project name, the version fan, a device switch and an Exit button, and the preview scaled to fill the rest.

### Modal
A native dialog: 6px corners, Pop shadow, 30% ink backdrop, a 16px bold title row over a hairline, 24px body padding, and a paper footer row with right-aligned actions.

### Client Review Overlay
The overlay prints the same world inside its shadow root: a white floating toolbar (6px, Pop) with a wash segment track and ink-selected 36px tool buttons, a white Primary action in ink, white popover cards with the same field and focus treatment, a right-hand drawer with hairline-separated items and wash reply blocks with caps labels, and an ink toast. Editable content is outlined with a 1.5px dashed Focus Blue line, turning green once edited. Note pins are teardrop markers (50% 50% 50% 3px) in the overlay pin colour, turning Imported Green when done.

## Do's and Don'ts

### Do:
- **Do** give every client exactly one spot ink from the ten in `swatch.ts`, and show it wherever that client appears (chip, rail, filters, version fan).
- **Do** print review state as a mark plus caps words (11px, 0.08em, bold), in the state hue.
- **Do** keep the primary action ink-filled with 4px corners, one per view.
- **Do** set counts, versions, codes and times in tabular figures.
- **Do** use the Chip shadow at rest and Lift only on hover, focus or selection.
- **Do** keep white text on a spot ink at 4.5:1 or better; Yellow and Orange take ink text.
- **Do** honour reduced motion: every transition and animation collapses to near zero.

### Don't:
- **Don't** colour a chip, card or row by review state; the spot colour is the client's.
- **Don't** use filled coloured status pills for review states; that is the grey SaaS table this world replaces.
- **Don't** add gradients, tints or transparency to spot inks.
- **Don't** introduce a second label size or a web font; the stack is Helvetica Neue, Helvetica, Arial.
- **Don't** use hard offset shadows or heavy borders; depth is a soft ink-tinted paper stack.
- **Don't** go lighter than Pale Grey (faint) for any text: it is the lightest grey that still reaches 4.5:1 on paper.
- **Don't** round corners past 6px on rectangles.
