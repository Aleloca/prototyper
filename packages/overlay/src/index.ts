import { Api, type Anchor, type Comment, type Kind, type State, type Value } from "./api";
import { cssPath, h, icon, shrinkImage, timeAgo } from "./dom";
import { strings, type Strings } from "./i18n";
import { PAGE_CSS, SHADOW_CSS } from "./styles";

interface Config {
  token: string;
  page: string;
  api: string;
}

type Mode = "view" | "edit" | "comment";

const SAVE_DEBOUNCE_MS = 800;
const supportsPlaintextOnly = (() => {
  const d = document.createElement("div");
  d.contentEditable = "plaintext-only";
  return d.contentEditable === "plaintext-only";
})();

const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  session(k: string, v?: string): string | null {
    try {
      if (v !== undefined) sessionStorage.setItem(k, v);
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
};

function kindOf(el: HTMLElement): Kind {
  const t = el.dataset.ptType;
  if (t === "rich" || t === "text" || t === "image" || t === "link") return t;
  if (el.tagName === "IMG") return "image";
  if (el.tagName === "A") return "link";
  return "text";
}

function bgUrl(el: HTMLElement): string {
  return /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(el.style.backgroundImage)?.[2] ?? "";
}

function readDom(el: HTMLElement, kind: Kind): Value {
  switch (kind) {
    case "text":
      return { kind, text: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
    case "rich":
      return { kind, html: el.innerHTML.trim() };
    case "image": {
      const img = el as HTMLImageElement;
      return { kind, src: img.getAttribute("src") ?? "", alt: img.alt };
    }
    case "link":
      return { kind, label: (el.textContent ?? "").replace(/\s+/g, " ").trim(), href: el.getAttribute("href") ?? "" };
    case "bg":
      return { kind, src: bgUrl(el) };
  }
}

function writeDom(el: HTMLElement, value: Value): void {
  switch (value.kind) {
    case "text":
      el.textContent = value.text;
      break;
    case "rich":
      el.innerHTML = value.html; // comes from our own published version or the server's sanitizer
      break;
    case "image": {
      const img = el as HTMLImageElement;
      img.removeAttribute("srcset");
      img.src = value.src;
      if (value.alt !== undefined) img.alt = value.alt;
      break;
    }
    case "link":
      el.textContent = value.label;
      el.setAttribute("href", value.href);
      break;
    case "bg":
      el.style.backgroundImage = `url("${value.src}")`;
      break;
  }
}

class Overlay {
  private readonly t: Strings;
  private readonly lang: string;
  private readonly api: Api;
  private state!: State;
  private author = storage.get("pt:author") ?? "";
  private mode: Mode = "view";
  private hidden = storage.session("pt:hidden") === "1";

  private readonly host = document.createElement("prototyper-review");
  private readonly root = h("div", { class: "root" });
  private readonly layer = h("div"); // absolutely positioned things: pins, popovers, bg buttons
  private readonly fixed = h("div"); // toolbar, hint, drawer, dialogs

  private readonly originals = new Map<string, Value>();
  private readonly edited = new Set<string>();
  private readonly timers = new Map<string, number>();
  private pending = 0;
  private saveError = false;
  private drawer: "notes" | "news" | null = null;
  private popover: HTMLElement | null = null;
  private activePin: string | null = null;
  private editTools: HTMLElement | null = null;

  constructor(private readonly cfg: Config) {
    this.lang = document.documentElement.lang || navigator.language || "en";
    this.t = strings(this.lang);
    this.api = new Api(cfg.api);
  }

  async start(): Promise<void> {
    try {
      this.state = await this.api.state();
    } catch {
      return; // link revoked or offline: show the page without the overlay
    }

    const pageStyle = document.createElement("style");
    pageStyle.textContent = PAGE_CSS;
    document.head.append(pageStyle);

    Object.assign(this.host.style, { position: "absolute", top: "0", left: "0", width: "0", height: "0", zIndex: "2147483000" });
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    Object.assign(this.layer.style, { position: "absolute", top: "0", left: "0" });
    this.root.append(this.layer, this.fixed);
    shadow.append(style, this.root);
    document.documentElement.append(this.host);

    this.captureOriginals();
    for (const e of this.state.edits) this.edited.add(e.key);
    this.markEdited();

    this.bindPageEvents();
    const saved = storage.session("pt:mode") as Mode | null;
    this.setMode(this.state.editable && saved && saved !== "view" && this.author ? saved : "view");

    // Show what changed when the client first opens a new version.
    const seenKey = `pt:seen:${this.cfg.token}`;
    if (this.state.version.number > 1 && Number(storage.get(seenKey) ?? 0) < this.state.version.number) {
      storage.set(seenKey, String(this.state.version.number));
      this.drawer = "news";
    }
    const noteHash = /#pt-note=([\w-]+)/.exec(location.hash)?.[1];
    if (noteHash) {
      history.replaceState(null, "", location.pathname + location.search);
      if (this.state.editable) this.setMode("comment");
      requestAnimationFrame(() => this.focusPin(noteHash));
    }
    this.render();

    const relayout = () => this.layout();
    window.addEventListener("resize", relayout);
    new ResizeObserver(relayout).observe(document.body);
    window.addEventListener("load", relayout);
  }

  // --- content ------------------------------------------------------------------------------

  private editables(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-pt]"));
  }

  private bgElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-pt-bg]"));
  }

  /** The page arrives with the round's edits applied; the true originals come from the server for edited keys. */
  private captureOriginals(): void {
    for (const el of this.editables()) {
      const key = el.dataset.pt!;
      if (!this.originals.has(key)) this.originals.set(key, this.state.originals[key] ?? readDom(el, kindOf(el)));
    }
    for (const el of this.bgElements()) {
      const key = el.dataset.ptBg!;
      if (!this.originals.has(key)) this.originals.set(key, this.state.originals[key] ?? readDom(el, "bg"));
    }
  }

  private markEdited(): void {
    for (const el of this.editables()) el.classList.toggle("pt-edited", this.edited.has(el.dataset.pt!));
  }

  private elementsFor(key: string): HTMLElement[] {
    const k = CSS.escape(key);
    return Array.from(document.querySelectorAll<HTMLElement>(`[data-pt="${k}"], [data-pt-bg="${k}"]`));
  }

  private scheduleSave(el: HTMLElement): void {
    const key = el.dataset.pt!;
    clearTimeout(this.timers.get(key));
    this.timers.set(key, window.setTimeout(() => void this.save(el), SAVE_DEBOUNCE_MS));
  }

  private async save(el: HTMLElement, value: Value = readDom(el, kindOf(el))): Promise<void> {
    const key = el.dataset.pt ?? el.dataset.ptBg!;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (JSON.stringify(value) === JSON.stringify(this.originals.get(key)) && !this.edited.has(key)) return;

    this.pending++;
    this.renderStatus();
    try {
      await this.api.putEdit(key, value, this.cfg.page, this.author);
      this.edited.add(key);
      this.saveError = false;
      // Same key elsewhere on the page (e.g. header and footer) mirrors the change.
      for (const other of this.elementsFor(key)) if (other !== el && other !== document.activeElement) writeDom(other, value);
    } catch {
      this.saveError = true;
      window.setTimeout(() => void this.save(el, value), 3000);
    } finally {
      this.pending--;
      this.markEdited();
      this.renderStatus();
    }
  }

  private async restore(el: HTMLElement): Promise<void> {
    const key = el.dataset.pt ?? el.dataset.ptBg!;
    const original = this.originals.get(key);
    if (!original) return;
    clearTimeout(this.timers.get(key));
    await this.api.deleteEdit(key, this.author);
    this.edited.delete(key);
    for (const other of this.elementsFor(key)) writeDom(other, original);
    this.markEdited();
    this.hideEditTools();
  }

  private async replaceImage(el: HTMLElement, kind: "image" | "bg"): Promise<void> {
    if (!(await this.ensureAuthor())) return;
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const key = kind === "image" ? el.dataset.pt! : el.dataset.ptBg!;
      this.toast(this.t.uploading);
      try {
        const { src } = await this.api.upload(key, await shrinkImage(file));
        const value: Value = kind === "image" ? { kind, src, alt: (el as HTMLImageElement).alt } : { kind, src };
        writeDom(el, value);
        await this.save(el, value);
        this.toast(this.t.saved);
      } catch {
        this.toast(this.t.uploadFailed, 5000);
      }
    });
    input.click();
  }

  // --- modes ------------------------------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
    storage.session("pt:mode", mode);
    const html = document.documentElement;
    html.classList.toggle("pt-edit", mode === "edit");
    html.classList.toggle("pt-comment", mode === "comment");
    for (const el of this.editables()) {
      const kind = kindOf(el);
      if (mode === "edit" && kind !== "image") {
        el.contentEditable = kind === "rich" || !supportsPlaintextOnly ? "true" : "plaintext-only";
        el.spellcheck = true;
      } else {
        el.removeAttribute("contenteditable");
      }
    }
    this.closePopover();
    this.hideEditTools();
    this.render();
  }

  private async switchMode(mode: Mode): Promise<void> {
    if (mode !== "view" && !(await this.ensureAuthor())) return;
    this.setMode(mode);
  }

  private bindPageEvents(): void {
    const fromOverlay = (e: Event) => e.composedPath().includes(this.host);

    document.addEventListener(
      "click",
      (e) => {
        if (fromOverlay(e)) return;
        const target = e.target as HTMLElement;
        if (this.mode === "comment") {
          e.preventDefault();
          e.stopPropagation();
          this.openComposer(target, e as MouseEvent);
          return;
        }
        if (this.mode === "edit") {
          const el = target.closest<HTMLElement>("[data-pt]");
          if (el) {
            // Editing a label must not follow its link or submit its form.
            if (target.closest("a, button, label, summary")) e.preventDefault();
            if (kindOf(el) === "image") {
              e.preventDefault();
              void this.replaceImage(el, "image");
            }
          }
        }
        if (this.popover && !fromOverlay(e)) this.closePopover();
      },
      true,
    );

    document.addEventListener("focusin", (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pt]");
      if (this.mode === "edit" && el && kindOf(el) !== "image") this.showEditTools(el);
    });

    document.addEventListener("focusout", (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pt]");
      if (this.mode !== "edit" || !el) return;
      if (this.timers.has(el.dataset.pt!)) void this.save(el);
      window.setTimeout(() => {
        if (!this.root.matches(":focus-within") && document.activeElement !== el) this.hideEditTools();
      }, 150);
    });

    document.addEventListener("input", (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pt]");
      if (this.mode === "edit" && el) this.scheduleSave(el);
    });

    document.addEventListener("keydown", (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pt]");
      if (this.mode !== "edit" || !el) return;
      if (e.key === "Escape") return el.blur();
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (kindOf(el) === "rich" && e.shiftKey) document.execCommand("insertLineBreak");
      else el.blur();
    });

    document.addEventListener("paste", (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pt]");
      if (this.mode !== "edit" || !el) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, kindOf(el) === "rich" ? text : text.replace(/\s+/g, " "));
    });
  }

  private async ensureAuthor(): Promise<boolean> {
    if (this.author) return true;
    return new Promise((resolve) => {
      const input = h("input", { class: "field", placeholder: this.t.namePlaceholder, autocomplete: "name", maxlength: 80 });
      const confirm = () => {
        const name = input.value.trim();
        if (!name) return input.focus();
        this.author = name;
        storage.set("pt:author", name);
        backdrop.remove();
        resolve(true);
      };
      input.addEventListener("keydown", (e) => e.key === "Enter" && confirm());
      const backdrop = h(
        "div",
        { class: "backdrop" },
        h(
          "div",
          { class: "card dialog", role: "dialog", "aria-modal": "true" },
          h("h2", {}, this.t.namePromptTitle),
          h("p", {}, this.t.namePromptText),
          input,
          h(
            "div",
            { class: "row" },
            h("button", { class: "btn", onclick: () => (backdrop.remove(), resolve(false)) }, this.t.cancel),
            h("button", { class: "btn primary", onclick: confirm }, this.t.continue),
          ),
        ),
      );
      this.fixed.append(backdrop);
      input.focus();
    });
  }

  // --- edit tools ---------------------------------------------------------------------------

  private showEditTools(el: HTMLElement): void {
    this.hideEditTools();
    const kind = kindOf(el);
    const key = el.dataset.pt!;
    const keep = (fn: () => void) => (e: Event) => {
      e.preventDefault(); // keep focus in the edited element
      fn();
    };
    const tools = h("div", { class: "card edit-tools" });
    if (kind === "rich") {
      tools.append(
        h("button", { title: this.t.bold, onmousedown: keep(() => document.execCommand("bold")) }, h("b", {}, "B")),
        h("button", { title: this.t.italic, onmousedown: keep(() => document.execCommand("italic")) }, h("i", {}, "I")),
      );
    }
    if (kind === "link") {
      tools.append(h("button", { onmousedown: keep(() => this.editLinkHref(el)) }, icon("link"), this.t.linkUrl));
    }
    if (this.edited.has(key)) {
      tools.append(h("button", { onmousedown: keep(() => void this.restore(el)) }, icon("undo"), this.t.restore));
    }
    if (!tools.childElementCount) return;
    const r = el.getBoundingClientRect();
    tools.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
    tools.style.top = `${Math.max(8, r.top + window.scrollY - 44)}px`;
    this.layer.append(tools);
    this.editTools = tools;
  }

  private hideEditTools(): void {
    this.editTools?.remove();
    this.editTools = null;
  }

  private editLinkHref(el: HTMLElement): void {
    const input = h("input", { class: "field", value: el.getAttribute("href") ?? "", "aria-label": this.t.linkUrl });
    const apply = () => {
      el.setAttribute("href", input.value.trim());
      void this.save(el);
      this.closePopover();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && apply());
    const r = el.getBoundingClientRect();
    this.openPopover(
      r.left + window.scrollX,
      r.bottom + window.scrollY + 8,
      h("div", {}, h("div", { class: "meta" }, this.t.linkUrl), input, h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.closePopover() }, this.t.cancel), h("button", { class: "btn primary", onclick: apply }, this.t.save))),
    );
    input.focus();
  }

  // --- comments -------------------------------------------------------------------------------

  private pageComments(): Comment[] {
    return this.state.comments.filter((c) => c.page === this.cfg.page);
  }

  private commentNumber(c: Comment): number {
    return this.state.comments.indexOf(c) + 1;
  }

  private anchorElement(a: Anchor): HTMLElement | null {
    if (a.key) return this.elementsFor(a.key)[0] ?? null;
    if (a.selector) {
      try {
        return document.querySelector<HTMLElement>(a.selector);
      } catch {
        return null;
      }
    }
    return null;
  }

  private pinPosition(c: Comment): { x: number; y: number } | null {
    const el = this.anchorElement(c.anchor);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX + c.anchor.x * r.width, y: r.top + window.scrollY + c.anchor.y * r.height };
  }

  private async openComposer(target: HTMLElement, e: MouseEvent): Promise<void> {
    if (!(await this.ensureAuthor())) return;
    const anchorEl = target.closest<HTMLElement>("[data-pt], [data-pt-bg]") ?? target;
    const r = anchorEl.getBoundingClientRect();
    const anchor: Anchor = {
      x: r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0,
      y: r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0,
      viewportWidth: window.innerWidth,
      ...(anchorEl.dataset.pt ? { key: anchorEl.dataset.pt } : anchorEl.dataset.ptBg ? { key: anchorEl.dataset.ptBg } : { selector: cssPath(anchorEl) }),
    };
    const textarea = h("textarea", { placeholder: this.t.notePlaceholder, maxlength: 5000 });
    const send = h("button", { class: "btn primary" }, this.t.send);
    const submit = async () => {
      const text = textarea.value.trim();
      if (!text) return textarea.focus();
      send.setAttribute("disabled", "");
      try {
        const c = await this.api.addComment(this.cfg.page, anchor, text, this.author);
        this.state.comments.push(c);
        this.closePopover();
        this.render();
      } catch {
        send.removeAttribute("disabled");
        this.toast(this.t.saveError);
      }
    };
    send.addEventListener("click", () => void submit());
    textarea.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) void submit();
    });
    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;
    this.openPopover(x, y + 12, h("div", {}, textarea, h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.closePopover() }, this.t.cancel), send)), { x, y });
    textarea.focus();
  }

  private openComment(c: Comment): void {
    const pos = this.pinPosition(c);
    if (!pos) return;
    this.activePin = c.id;
    const body = h(
      "div",
      {},
      h("div", { class: "meta" }, h("span", { class: "num" }, String(this.commentNumber(c))), `${c.author} · ${timeAgo(c.createdAt, this.lang)}`),
      h("p", { class: "note-text" }, c.text),
    );
    if (this.state.editable) {
      body.append(
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn danger", onclick: () => void this.deleteComment(c) }, this.t.delete),
          h("button", { class: "btn", onclick: () => this.editComment(c, body) }, this.t.editNote),
        ),
      );
    }
    this.openPopover(pos.x, pos.y + 20, body);
    this.renderPins();
  }

  private editComment(c: Comment, container: HTMLElement): void {
    const textarea = h("textarea", { maxlength: 5000 });
    textarea.value = c.text;
    const save = async () => {
      const text = textarea.value.trim();
      if (!text) return;
      const updated = await this.api.updateComment(c.id, text);
      Object.assign(c, updated);
      this.closePopover();
      this.render();
    };
    container.replaceChildren(textarea, h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.closePopover() }, this.t.cancel), h("button", { class: "btn primary", onclick: () => void save() }, this.t.save)));
    textarea.focus();
  }

  private async deleteComment(c: Comment): Promise<void> {
    await this.api.deleteComment(c.id);
    this.state.comments = this.state.comments.filter((x) => x.id !== c.id);
    this.closePopover();
    this.render();
  }

  private focusPin(id: string): void {
    const c = this.state.comments.find((x) => x.id === id);
    if (!c) return;
    const pos = this.pinPosition(c);
    if (pos) window.scrollTo({ top: Math.max(0, pos.y - window.innerHeight / 3), behavior: "smooth" });
    window.setTimeout(() => this.openComment(c), 350);
  }

  // --- popovers, toasts -----------------------------------------------------------------------

  private openPopover(x: number, y: number, content: HTMLElement, ghostPin?: { x: number; y: number }): void {
    this.closePopover();
    const pop = h("div", { class: "card pop" }, content);
    const width = Math.min(300, window.innerWidth - 24);
    pop.style.left = `${Math.min(Math.max(12 + window.scrollX, x - 20), window.scrollX + window.innerWidth - width - 12)}px`;
    pop.style.top = `${y}px`;
    const wrap = h("div", {});
    if (ghostPin) {
      const pin = h("div", { class: "pin active" }, "+");
      pin.style.left = `${ghostPin.x}px`;
      pin.style.top = `${ghostPin.y}px`;
      wrap.append(pin);
    }
    wrap.append(pop);
    this.layer.append(wrap);
    this.popover = wrap;
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
    if (this.activePin) {
      this.activePin = null;
      this.renderPins();
    }
  }

  private toast(text: string, ms = 2200): void {
    const t = h("div", { class: "toast", role: "status" }, text);
    this.fixed.append(t);
    window.setTimeout(() => t.remove(), ms);
  }

  // --- rendering --------------------------------------------------------------------------------

  private layout(): void {
    this.renderPins();
    this.renderBgButtons();
  }

  private render(): void {
    this.fixed.replaceChildren();
    if (this.hidden) {
      this.fixed.append(
        h("div", { class: "mini" }, h("button", { class: "tb", onclick: () => this.setHidden(false) }, icon("pen"), h("span", { class: "label" }, this.t.show))),
      );
    } else {
      this.fixed.append(this.renderBar());
      const hint = this.mode === "edit" ? this.t.editHint : this.mode === "comment" ? this.t.commentHint : null;
      if (hint) this.fixed.append(h("div", { class: "hint" }, hint));
    }
    if (this.drawer) this.fixed.append(this.renderDrawer());
    this.layout();
  }

  private setHidden(hidden: boolean): void {
    this.hidden = hidden;
    storage.session("pt:hidden", hidden ? "1" : "0");
    if (hidden) this.setMode("view");
    else this.render();
  }

  private renderBar(): HTMLElement {
    const t = this.t;
    const bar = h("div", { class: "bar", role: "toolbar", "aria-label": "Review" });
    const modeBtn = (mode: Mode, ic: Parameters<typeof icon>[0], label: string) =>
      h("button", { class: "tb", "aria-pressed": String(this.mode === mode), onclick: () => void this.switchMode(mode) }, icon(ic), h("span", { class: "label" }, label));

    if (this.state.editable) {
      bar.append(h("div", { class: "seg" }, modeBtn("view", "eye", t.view), modeBtn("edit", "pen", t.edit), modeBtn("comment", "note", t.comment)), h("div", { class: "sep" }));
    } else {
      bar.append(h("span", { class: "badge", title: this.state.round.status === "imported" ? t.importedHint : t.readOnlyHint }, t.readOnly));
    }

    bar.append(
      h(
        "button",
        { class: "tb", "aria-pressed": String(this.drawer === "notes"), onclick: () => this.toggleDrawer("notes") },
        icon("list"),
        h("span", { class: "label" }, t.notes),
        h("span", { class: "count" }, String(this.state.comments.length)),
      ),
    );
    if (this.state.version.number > 1) {
      bar.append(h("button", { class: "tb", "aria-pressed": String(this.drawer === "news"), onclick: () => this.toggleDrawer("news") }, icon("sparkle"), h("span", { class: "label" }, t.whatsNew)));
    }

    if (this.state.editable) {
      const status = h("span", { class: "status", role: "status" });
      status.dataset.role = "status";
      bar.append(status);
      bar.append(
        this.state.round.status === "submitted"
          ? h("span", { class: "badge" }, t.submittedBadge)
          : h("button", { class: "tb primary", onclick: () => this.confirmDone() }, icon("check"), h("span", { class: "label" }, t.done)),
      );
    }
    bar.append(h("button", { class: "tb", title: t.hide, "aria-label": t.hide, onclick: () => this.setHidden(true) }, icon("chevron")));
    queueMicrotask(() => this.renderStatus());
    return bar;
  }

  private renderStatus(): void {
    const el = this.fixed.querySelector<HTMLElement>('[data-role="status"]');
    if (!el) return;
    el.className = "status";
    if (this.saveError) el.textContent = this.t.saveError;
    else if (this.pending > 0) el.textContent = this.t.saving;
    else if (this.edited.size > 0) {
      el.textContent = `✓ ${this.t.saved}`;
      el.classList.add("ok");
    } else el.textContent = "";
  }

  private toggleDrawer(which: "notes" | "news"): void {
    this.drawer = this.drawer === which ? null : which;
    this.render();
  }

  private renderDrawer(): HTMLElement {
    const t = this.t;
    const body = h("div", { class: "body" });
    if (this.drawer === "news") {
      body.append(h("h3", {}, `${t.versionLabel} ${this.state.version.number}`), h("div", { class: "changelog" }, this.state.version.changelog || "—"));
      if (this.state.previousComments.length) {
        body.append(h("h3", {}, t.previousNotes));
        for (const c of this.state.previousComments) {
          const item = h("div", { class: "item" }, h("div", { class: "meta" }, `${c.author} · ${c.page}`), h("p", { class: "note-text" }, c.text));
          if (c.reply || c.status !== "open") {
            item.append(
              h(
                "div",
                { class: "reply" },
                h("div", { class: `label ${c.status === "resolved" ? "ok" : ""}` }, c.status === "resolved" ? `✓ ${t.resolved}` : t.answered),
                c.reply ? h("div", {}, c.reply) : null,
              ),
            );
          }
          body.append(item);
        }
      }
    } else {
      if (!this.state.comments.length) body.append(h("p", { class: "empty" }, t.noNotes));
      for (const c of this.state.comments) {
        const here = c.page === this.cfg.page;
        body.append(
          h(
            "div",
            { class: "item" },
            h(
              "button",
              {
                class: "goto",
                onclick: () => {
                  if (here) {
                    this.drawer = window.innerWidth < 640 ? null : this.drawer;
                    this.render();
                    this.focusPin(c.id);
                  } else {
                    location.href = `${this.relativeUrl(c.page)}#pt-note=${c.id}`;
                  }
                },
              },
              h("div", { class: "meta" }, h("span", { class: "num" }, String(this.commentNumber(c))), `${c.author} · ${timeAgo(c.createdAt, this.lang)}${here ? "" : ` · ${t.onOtherPage} ${c.page}`}`),
              h("p", { class: "note-text" }, c.text),
            ),
          ),
        );
      }
    }
    return h(
      "div",
      { class: "card drawer", role: "dialog", "aria-label": this.drawer === "news" ? t.whatsNew : t.notes },
      h("header", {}, this.drawer === "news" ? t.whatsNew : t.notes, h("button", { class: "x", "aria-label": t.close, onclick: () => this.toggleDrawer(this.drawer!) }, icon("close"))),
      body,
    );
  }

  /** URL of another page of the demo, relative to the share root. */
  private relativeUrl(page: string): string {
    return `/s/${this.cfg.token}/${page}`;
  }

  private renderPins(): void {
    this.layer.querySelectorAll(".pin:not(.active)").forEach((p) => p.remove());
    const visible = this.mode === "comment" || this.drawer === "notes";
    if (!visible) return;
    for (const c of this.pageComments()) {
      const pos = this.pinPosition(c);
      if (!pos) continue;
      const pin = h("button", { class: `pin${this.activePin === c.id ? " active" : ""}`, "aria-label": `${this.t.notes} ${this.commentNumber(c)}` }, String(this.commentNumber(c)));
      pin.style.left = `${pos.x}px`;
      pin.style.top = `${pos.y}px`;
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openComment(c);
      });
      this.layer.prepend(pin);
    }
  }

  private renderBgButtons(): void {
    this.layer.querySelectorAll(".bg-btn").forEach((b) => b.remove());
    if (this.mode !== "edit") return;
    for (const el of this.bgElements()) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const btn = h("button", { class: "bg-btn", onclick: () => void this.replaceImage(el, "bg") }, icon("image"), this.t.changeBackground);
      btn.style.left = `${r.right + window.scrollX - 200}px`;
      btn.style.top = `${r.top + window.scrollY + 12}px`;
      this.layer.append(btn);
    }
  }

  private confirmDone(): void {
    const t = this.t;
    const backdrop = h("div", { class: "backdrop" });
    const send = h("button", { class: "btn primary" }, t.doneConfirm);
    send.addEventListener("click", async () => {
      send.setAttribute("disabled", "");
      // Flush pending text edits first.
      for (const el of this.editables()) if (this.timers.has(el.dataset.pt!)) await this.save(el);
      try {
        await this.api.submit(this.author || "—");
        this.state.round.status = "submitted";
        backdrop.replaceChildren(
          h("div", { class: "card dialog", role: "dialog" }, h("h2", {}, t.thanksTitle), h("p", {}, t.thanksText), h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => (backdrop.remove(), this.setMode("view")) }, t.close))),
        );
      } catch {
        send.removeAttribute("disabled");
        this.toast(t.saveError);
      }
    });
    backdrop.append(h("div", { class: "card dialog", role: "dialog", "aria-modal": "true" }, h("h2", {}, t.doneTitle), h("p", {}, t.doneText), h("div", { class: "row" }, h("button", { class: "btn", onclick: () => backdrop.remove() }, t.cancel), send)));
    this.fixed.append(backdrop);
  }
}

const cfg = (window as unknown as { __PT__?: Config }).__PT__;
if (cfg && !(window as unknown as { __PT_STARTED__?: boolean }).__PT_STARTED__) {
  (window as unknown as { __PT_STARTED__: boolean }).__PT_STARTED__ = true;
  const boot = () => void new Overlay(cfg).start();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
