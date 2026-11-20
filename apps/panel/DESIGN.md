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

<!-- impeccable:design-map -->
Name: Prototyper
Colors: primary: ink #151515; secondary: spot-warm-red #c84c28; tertiary: attention #a85a12; neutral: paper #fafaf7; secondary: spot-process-blue #2b7da0; secondary: spot-yellow #f2c14e (+24 more in the sidecar)
Fonts: Helvetica Neue (display, headline, chip-title, title, body, body-sm, caption, label)
Spacing: xs 8px, sm 12px, md 16px, lg 20px, xl 24px, 2xl 28px, 3xl 32px
Radius: hairline 2px, chip 3px, control 4px, floating 6px
North Star: "The Studio Swatch Book"
Rules:
- The Colour Is Who Rule. A spot colour identifies a client and nothing else.
- The Solid Ink Rule. Spot colours are printed flat: no gradients, no transparency, no tints on the chip itself.
- The Ink Button Rule. The primary action is ink on white.
- The One Label Size Rule. Labels are 11px bold caps tracked 0.08em.
- The Tabular Rule. Every number that can change (counts, versions, swatch codes, times) is set with tabular figures.
- The Paper Stack Rule. At rest everything sits one sheet high.
Elevation:
- Chip: 0 1px 2px rgb(21 21 21 / 0.06), 0 0 0 1px rgb(21 21 21 / 0.07)
- Lift: 0 10px 24px -8px rgb(21 21 21 / 0.22), 0 0 0 1px rgb(21 21 21 / 0.08)
- Pop: 0 18px 40px -12px rgb(21 21 21 / 0.28), 0 0 0 1px rgb(21 21 21 / 0.08)
Don't:
- Don't colour a chip, card or row by review state; the spot colour is the client's.
- Don't use filled coloured status pills for review states; that is the grey SaaS table this world replaces.
- Don't add gradients, tints or transparency to spot inks.
- Don't introduce a second label size or a web font; the stack is Helvetica Neue, Helvetica, Arial.
- Don't use hard offset shadows or heavy borders; depth is a soft ink-tinted paper stack.
- Don't go lighter than Pale Grey (faint) for any text: it is the lightest grey that still reaches 4.5:1 on paper.
- Don't round corners past 6px on rectangles.
Do:
- Do give every client exactly one spot ink from the ten in `swatch.ts`, and show it wherever that client appears (chip, rail, filters, version fan).
- Do print review state as a mark plus caps words (11px, 0.08em, bold), in the state hue.
- Do keep the primary action ink-filled with 4px corners, one per view.
- Do set counts, versions, codes and times in tabular figures.
- Do use the Chip shadow at rest and Lift only on hover, focus or selection.
- (+2 more)
Full: .impeccable/design-full.md (read a section when you need its detail)
