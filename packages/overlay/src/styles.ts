/** Styles inside the overlay's shadow root. */
export const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --ink: #17181b; --muted: #6b6e76; --line: #e3e3df; --panel: #ffffff; --soft: #f4f4f1;
  --accent: #3157d5; --accent-soft: #e8edfc; --ok: #23824f; --danger: #c2413a; --pin: #f05a28;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  color: var(--ink); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
textarea, input { font: inherit; color: var(--ink); }
.icon { display: inline-flex; width: 18px; height: 18px; flex: none; }
.icon svg { width: 100%; height: 100%; }

/* Toolbar */
.bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 3;
  display: flex; align-items: center; gap: 4px; padding: 5px;
  background: rgba(23,24,27,.94); color: #fff; border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.06) inset;
  backdrop-filter: blur(8px); max-width: calc(100vw - 24px);
}
.seg { display: flex; gap: 2px; background: rgba(255,255,255,.07); border-radius: 10px; padding: 2px; }
.tb { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 8px; white-space: nowrap; color: rgba(255,255,255,.78); }
.tb:hover { background: rgba(255,255,255,.1); color: #fff; }
.tb[aria-pressed="true"] { background: #fff; color: var(--ink); }
.tb.primary { background: var(--accent); color: #fff; }
.tb.primary:hover { background: #4268e6; }
.tb .count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(255,255,255,.18); font-size: 11px; display: inline-grid; place-items: center; }
.sep { width: 1px; height: 22px; background: rgba(255,255,255,.14); margin: 0 4px; }
.status { font-size: 12px; color: rgba(255,255,255,.6); padding: 0 8px; white-space: nowrap; }
.status.ok { color: #8fe3b0; }
.badge { font-size: 12px; padding: 4px 10px; border-radius: 8px; background: rgba(255,255,255,.1); white-space: nowrap; }
.mini { position: fixed; right: 16px; bottom: 16px; z-index: 3; }
.mini .tb { background: rgba(23,24,27,.94); color: #fff; height: 40px; box-shadow: 0 8px 24px rgba(0,0,0,.2); border-radius: 12px; }

.hint {
  position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 2;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px;
  box-shadow: 0 6px 20px rgba(0,0,0,.12); font-size: 13px; color: var(--muted); max-width: calc(100vw - 32px); text-align: center;
}

/* Floating cards: popovers, dialogs, drawer */
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,.18); }
.pop { position: absolute; z-index: 4; width: 300px; padding: 12px; }
.pop textarea, .field { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; outline: none; background: #fff; }
.pop textarea { min-height: 84px; resize: vertical; }
.pop textarea:focus, .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(49,87,213,.15); }
.row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px; }
.btn { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: #fff; font-weight: 500; }
.btn:hover { background: var(--soft); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: #2a4cc0; }
.btn.danger { color: var(--danger); }
.btn:disabled { opacity: .5; cursor: default; }
.meta { font-size: 12px; color: var(--muted); }
.note-text { white-space: pre-wrap; margin: 6px 0 0; }

.edit-tools { position: absolute; z-index: 4; display: flex; gap: 2px; padding: 3px; border-radius: 10px; }
.edit-tools button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px; border-radius: 7px; font-size: 13px; }
.edit-tools button:hover { background: var(--soft); }
.edit-tools b, .edit-tools i { width: 14px; text-align: center; }

.bg-btn { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 8px; background: rgba(23,24,27,.86); color: #fff; font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,.2); }

/* Pins */
.pin {
  position: absolute; z-index: 2; width: 28px; height: 28px; margin: -14px 0 0 -14px;
  border-radius: 50% 50% 50% 4px; background: var(--pin); color: #fff; font-size: 12px; font-weight: 600;
  display: grid; place-items: center; box-shadow: 0 4px 12px rgba(0,0,0,.25), 0 0 0 2px #fff;
  transition: transform .12s;
}
.pin:hover, .pin.active { transform: scale(1.12); }
.pin.done { background: var(--ok); }

/* Drawer */
.drawer { position: fixed; z-index: 5; top: 12px; right: 12px; bottom: 12px; width: 360px; max-width: calc(100vw - 24px); display: flex; flex-direction: column; overflow: hidden; }
.drawer header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); font-weight: 600; }
.drawer header .x { margin-left: auto; color: var(--muted); }
.drawer .body { overflow-y: auto; padding: 8px 16px 16px; }
.item { padding: 12px 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.item button.goto { text-align: left; width: 100%; }
.num { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--pin); color: #fff; font-size: 11px; font-weight: 600; margin-right: 6px; }
.reply { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--soft); font-size: 13px; }
.reply .label { font-weight: 600; font-size: 12px; }
.reply .label.ok { color: var(--ok); }
.changelog { white-space: pre-wrap; padding: 4px 0 8px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 4px; }
.empty { color: var(--muted); padding: 16px 0; }

.backdrop { position: fixed; inset: 0; z-index: 6; background: rgba(0,0,0,.3); display: grid; place-items: center; padding: 16px; }
.dialog { width: 400px; max-width: 100%; padding: 20px; }
.dialog h2 { font-size: 17px; margin: 0 0 6px; }
.dialog p { color: var(--muted); margin: 0 0 14px; }

.toast { position: fixed; z-index: 7; left: 50%; top: 20px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; background: var(--ink); color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.25); }

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
html.pt-edit [data-pt] { outline: 1.5px dashed rgba(49,87,213,.55); outline-offset: 3px; border-radius: 2px; cursor: text; transition: outline-color .15s, background-color .15s; }
html.pt-edit img[data-pt] { cursor: pointer; }
html.pt-edit [data-pt]:hover { outline-color: rgba(49,87,213,.95); background-color: rgba(49,87,213,.06); }
html.pt-edit [data-pt]:focus { outline: 2px solid #3157d5; background-color: rgba(49,87,213,.05); }
html.pt-edit [data-pt].pt-edited { outline-color: rgba(35,130,79,.7); }
html.pt-edit [data-pt-bg] { outline: 1.5px dashed rgba(49,87,213,.35); outline-offset: -2px; }
html.pt-comment, html.pt-comment * { cursor: crosshair !important; }
`;
