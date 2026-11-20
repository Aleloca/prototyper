/** Styles inside the overlay's shadow root. */
export const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --ink: #151515; --ink-2: #3a3a36; --muted: #5f5e58; --line: #e6e5df; --line-strong: #d6d5cd; --panel: #ffffff; --soft: #f2f1ec;
  --accent: #151515; --focus: #2e86ab; --ok: #2b7a4b; --danger: #b8322a; --pin: #c84c28;
  --shadow: 0 1px 2px rgba(21,21,21,.06), 0 0 0 1px rgba(21,21,21,.08);
  --shadow-pop: 0 18px 40px -12px rgba(21,21,21,.3), 0 0 0 1px rgba(21,21,21,.08);
  font: 14px/1.45 "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
  color: var(--ink); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
textarea, input { font: inherit; color: var(--ink); caret-color: var(--ink); }
.icon { display: inline-flex; width: 18px; height: 18px; flex: none; }
.icon svg { width: 100%; height: 100%; }

/* Toolbar: a printed label strip */
.bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 3;
  display: flex; align-items: center; gap: 6px; padding: 6px;
  background: var(--panel); color: var(--ink); border-radius: 6px;
  box-shadow: var(--shadow-pop); max-width: calc(100vw - 24px);
}
.seg { display: flex; gap: 2px; background: var(--soft); border-radius: 4px; padding: 2px; }
.tb { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 3px; white-space: nowrap; color: var(--muted); font-weight: 500; transition: background-color .15s, color .15s; }
.tb:hover { background: rgba(21,21,21,.05); color: var(--ink); }
.tb[aria-pressed="true"] { background: var(--ink); color: #fff; }
.tb.primary { background: var(--ink); color: #fff; font-weight: 600; }
.tb.primary:hover { background: var(--ink-2); }
.tb .count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--pin); color: #fff; font-size: 11px; font-weight: 700; display: inline-grid; place-items: center; font-variant-numeric: tabular-nums; }
.tb.icon-only { padding: 0 9px; }
.tb:disabled { opacity: .4; cursor: default; }
.tb:disabled:hover { background: none; color: var(--muted); }
.stage { position: fixed; inset: 0; z-index: 1; background: #ebeae4; display: flex; justify-content: center; padding: 20px 16px 136px; overflow: auto; }
.device { height: 100%; max-width: 100%; border: 0; border-radius: 6px; background: #fff; box-shadow: var(--shadow-pop); flex: none; }
.sep { width: 1px; height: 22px; background: var(--line); margin: 0 2px; }
.status { font-size: 12px; color: var(--muted); padding: 0 8px; white-space: nowrap; }
.status.ok { color: var(--ok); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.status .icon, .reply .label .icon { width: 14px; height: 14px; }
.reply .label { display: flex; align-items: center; gap: 4px; }
.badge { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 5px 8px; border-radius: 2px; background: var(--soft); color: var(--ink-2); white-space: nowrap; }
.mini { position: fixed; right: 16px; bottom: 16px; z-index: 3; }
.mini .tb { background: var(--panel); color: var(--ink); height: 40px; box-shadow: var(--shadow-pop); border-radius: 6px; }

.hint {
  position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); z-index: 2;
  background: var(--ink); color: #fff; border-radius: 4px; padding: 8px 14px;
  box-shadow: var(--shadow-pop); font-size: 13px; max-width: calc(100vw - 32px); text-align: center;
}

/* Floating cards: popovers, dialogs, drawer */
.card { background: var(--panel); border-radius: 6px; box-shadow: var(--shadow-pop); }
.pop { position: absolute; z-index: 4; width: 300px; padding: 12px; }
.pop textarea, .field { width: 100%; border: 1px solid var(--line-strong); border-radius: 4px; padding: 8px 10px; outline: none; background: #fff; }
.pop textarea { min-height: 84px; resize: vertical; }
.pop textarea:focus, .field:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(46,134,171,.18); }
.row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px; }
.btn { height: 32px; padding: 0 12px; border-radius: 4px; border: 1px solid var(--line-strong); background: #fff; font-weight: 500; transition: background-color .15s; }
.btn:hover { background: var(--soft); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--ink-2); }
.btn.danger { color: var(--danger); }
.btn:disabled { opacity: .5; cursor: default; }
.meta { font-size: 12px; color: var(--muted); }
.note-text { white-space: pre-wrap; margin: 6px 0 0; }

.edit-tools { position: absolute; z-index: 4; display: flex; gap: 2px; padding: 3px; border-radius: 6px; }
.edit-tools button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px; border-radius: 3px; font-size: 13px; }
.edit-tools button:hover { background: var(--soft); }
.edit-tools b, .edit-tools i { width: 14px; text-align: center; }

.bg-btn { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 4px; background: var(--panel); color: var(--ink); font-size: 13px; font-weight: 500; box-shadow: var(--shadow-pop); }

/* Pins */
.pin {
  position: absolute; z-index: 2; width: 28px; height: 28px; margin: -14px 0 0 -14px;
  border-radius: 50% 50% 50% 3px; background: var(--pin); color: #fff; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
  display: grid; place-items: center; box-shadow: 0 6px 14px -4px rgba(21,21,21,.4), 0 0 0 2px #fff;
  transition: transform .12s;
}
.pin:hover, .pin.active { transform: scale(1.12); }
.pin.done { background: var(--ok); }

/* Drawer */
.drawer { position: fixed; z-index: 5; top: 12px; right: 12px; bottom: 12px; width: 360px; max-width: calc(100vw - 24px); display: flex; flex-direction: column; overflow: hidden; }
.drawer header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); font-weight: 700; letter-spacing: -.01em; }
.drawer header .x { margin-left: auto; color: var(--muted); }
.drawer .body { overflow-y: auto; padding: 8px 16px 16px; }
.item { padding: 12px 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.item button.goto { text-align: left; width: 100%; }
.num { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--pin); color: #fff; font-size: 11px; font-weight: 700; margin-right: 6px; font-variant-numeric: tabular-nums; }
.reply { margin-top: 8px; padding: 8px 10px; border-radius: 4px; background: var(--soft); font-size: 13px; color: var(--ink-2); }
.reply .label { font-weight: 700; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.reply .label.ok { color: var(--ok); }
.changelog { white-space: pre-wrap; padding: 4px 0 8px; }
h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 16px 0 4px; }
.empty { color: var(--muted); padding: 16px 0; }

.backdrop { position: fixed; inset: 0; z-index: 6; background: rgba(21,21,21,.3); display: grid; place-items: center; padding: 16px; }
.dialog { width: 400px; max-width: 100%; padding: 20px; }
.dialog h2 { font-size: 17px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 6px; }
.dialog p { color: var(--muted); margin: 0 0 14px; }

.toast { position: fixed; z-index: 7; left: 50%; top: 20px; transform: translateX(-50%); padding: 10px 16px; border-radius: 4px; background: var(--ink); color: #fff; box-shadow: var(--shadow-pop); }

@media (max-width: 900px) {
  .devices { display: none; }
}
@media (max-width: 640px) {
  .bar { left: 8px; right: 8px; bottom: 8px; transform: none; justify-content: space-between; overflow-x: auto; }
  .tb { padding: 0 10px; }
  .tb .label { display: none; }
  .hint { bottom: 64px; }
  .pop { width: min(300px, calc(100vw - 24px)); }
  .drawer { top: auto; height: 70vh; left: 8px; right: 8px; bottom: 8px; width: auto; }
}
`;

/** Styles injected into the page itself, to highlight editable content. Scoped by classes on <html>. */
export const PAGE_CSS = `
html.pt-edit [data-pt] { outline: 1.5px dashed rgba(46,134,171,.6); outline-offset: 3px; border-radius: 2px; cursor: text; transition: outline-color .15s, background-color .15s; }
html.pt-edit img[data-pt] { cursor: pointer; }
html.pt-edit [data-pt]:hover { outline-color: rgba(46,134,171,1); background-color: rgba(46,134,171,.07); }
html.pt-edit [data-pt]:focus { outline: 2px solid #2e86ab; background-color: rgba(46,134,171,.06); }
html.pt-edit [data-pt].pt-edited { outline-color: rgba(43,122,75,.8); }
html.pt-edit [data-pt-bg] { outline: 1.5px dashed rgba(46,134,171,.4); outline-offset: -2px; }
html.pt-comment, html.pt-comment * { cursor: crosshair !important; }
`;
