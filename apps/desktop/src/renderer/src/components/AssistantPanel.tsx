import { useEffect, useRef, useState } from "react";
import type { AssistantAttachment, AssistantEvent, DemoRef } from "@common/types";
import { api } from "../api";
import { errorMessage } from "../format";
import { useT } from "../i18n";
import { Markdownish } from "./Markdown";

const EXAMPLES = [
  "A landing page for Pasticceria Rossi in Bergamo: artisan cakes, order online. Take the style from pasticceriarossi.it",
  "In the Studio Bianchi demo, make the hero more minimal and add a FAQ section",
  "Extract the brand of Studio Bianchi from their website",
];

/** The home chat: tell Claude what you need, it creates clients and demos and routes changes. */
export function AssistantPanel(props: { onOpen: (ref: DemoRef) => void }) {
  const t = useT();
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [over, setOver] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api.assistant.log().then(setEvents);
    void api.assistant.running().then(setRunning);
    return api.onAssistantEvent((e) => {
      if (e.type === "phase") {
        setRunning(true);
        setPhase(e.message);
        return;
      }
      if (e.type === "done") {
        setRunning(false);
        setPhase(undefined);
      }
      setEvents((prev) => [...prev, e]);
    });
  }, []);

  useEffect(() => {
    // Braces matter: scrollIntoView() returns a Promise in recent Chromium.
    bottom.current?.scrollIntoView({ block: "end" });
  }, [events.length, running]);

  /** Files with a path (dropped, picked, copied in Finder) go to the main process, which tells images from page sources. */
  const attachPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setImporting(true);
    setError(undefined);
    try {
      const added = await api.assistant.attach(paths);
      setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const addFiles = async (files: File[]) => {
    const paths: string[] = [];
    for (const file of files) {
      const path = api.pathForFile(file);
      if (path) {
        paths.push(path);
        continue;
      }
      // Pasted image data (a screenshot copied to the clipboard) has no path.
      if (!file.type.startsWith("image/")) continue;
      try {
        const saved = await api.assistant.attachData(new Uint8Array(await file.arrayBuffer()), (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg"));
        setAttachments((prev) => [...prev, { kind: "image", path: saved, name: file.name || "image", preview: URL.createObjectURL(file) }]);
      } catch (e) {
        setError(errorMessage(e));
      }
    }
    await attachPaths(paths);
  };

  const send = async () => {
    const message = text.trim();
    if ((!message && !attachments.length) || running || importing) return;
    setError(undefined);
    setText("");
    const files = attachments.map((a) => a.path);
    setAttachments([]);
    setRunning(true);
    try {
      const fallback = attachments.some((a) => a.kind === "source") ? t("Start from this page.") : t("Here are some references.");
      await api.assistant.send(message || fallback, files);
    } catch (e) {
      setError(errorMessage(e));
      setRunning(false);
    }
  };

  const newConversation = async () => {
    try {
      await api.assistant.reset();
      setEvents([]);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section
      className="relative flex min-h-0 w-[460px] shrink-0 flex-col border-r border-line bg-panel"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-semibold">Claude</span>
        <span className="text-[12px] text-faint">{t("tell me what you need")}</span>
        {events.length > 0 && (
          <button className="btn btn-ghost ml-auto py-1 text-[12px]" disabled={running} onClick={() => void newConversation()}>
            {t("New conversation")}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {events.length === 0 && !running && (
          <div className="mt-6">
            <p className="text-[15px] font-medium">{t("What do you need?")}</p>
            <p className="mt-1 text-muted">
              {t("Describe a new demo, a change to an existing one, a brand to extract… I'll work out the client and the details, and only ask what I really need. You can drop screenshots here, or an existing page to start from: a folder, a zip or its HTML and CSS files.")}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="rounded-lg border border-line px-3 py-2 text-left text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-ink"
                  onClick={() => {
                    setText(t(ex));
                    input.current?.focus();
                  }}
                >
                  {t(ex)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {events.map((e, i) => (
            <AssistantItem key={i} event={e} onOpen={props.onOpen} />
          ))}
        </div>

        {running && (
          <div className="mt-3 flex items-center gap-2 text-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span className="truncate font-mono text-[11.5px]">{phase || t("Thinking…")}</span>
          </div>
        )}
        {error && <p className="mt-3 text-danger">{error}</p>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span key={a.path} className="relative">
                {a.kind === "source" ? (
                  <span className="flex h-14 max-w-56 items-center gap-2 rounded border border-line bg-canvas px-2.5" title={a.name}>
                    <span className="text-[18px]">🗂</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{a.name}</span>
                      <span className="block text-[11.5px] text-faint">{t("Page to start from · {n} files", { n: a.files ?? 0 })}</span>
                    </span>
                  </span>
                ) : a.preview ? (
                  <img src={a.preview} alt={a.name} className="h-14 w-20 rounded border border-line object-cover" />
                ) : (
                  <span className="grid h-14 w-20 place-items-center rounded border border-line bg-canvas px-1 text-center text-[11px] text-muted">{a.name}</span>
                )}
                <button
                  className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] text-white"
                  aria-label={t("Remove")}
                  onClick={() => setAttachments(attachments.filter((x) => x.path !== a.path))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          className="input min-h-[84px] resize-none"
          placeholder={running ? t("Claude is working…") : t("Describe what you need…  (⌘↵ to send)")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn btn-ghost py-1 text-[12px]"
            disabled={importing}
            title={t("Screenshots to use as references, or an existing page to start from (folder, zip, HTML and CSS)")}
            onClick={() => void api.assistant.pick().then(attachPaths)}
          >
            📎 {t("Attach")}
          </button>
          <span className="truncate text-[12px] text-faint">{importing ? t("Importing…") : t("screenshots, or a page to start from")}</span>
          {running ? (
            <button className="btn ml-auto" onClick={() => void api.assistant.cancel()}>
              {t("Stop")}
            </button>
          ) : (
            <button className="btn btn-primary ml-auto" disabled={(!text.trim() && !attachments.length) || importing} onClick={() => void send()}>
              {t("Send")}
            </button>
          )}
        </div>
      </div>

      {over && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 font-medium text-accent">
          {t("Drop screenshots, or a page to start from (folder, zip, HTML)")}
        </div>
      )}
    </section>
  );
}

function AssistantItem({ event: e, onOpen }: { event: AssistantEvent; onOpen: (ref: DemoRef) => void }) {
  const t = useT();
  switch (e.type) {
    case "user":
      return (
        <div className="ml-10 rounded-lg bg-accent-soft px-3 py-2">
          <div className="whitespace-pre-wrap">{e.text}</div>
          {e.attachments.length > 0 && <div className="mt-1 text-[12px] text-muted">📎 {e.attachments.length}</div>}
        </div>
      );
    case "assistant":
      return <Markdownish text={e.text} />;
    case "action":
      return (
        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] ${e.ok ? "border-line bg-canvas" : "border-danger/30 bg-danger/5 text-danger"}`}>
          <span className={e.ok ? "text-ok" : ""}>{e.ok ? "✓" : "✕"}</span>
          <span className="min-w-0 flex-1">{t(e.text, e.vars)}</span>
          {e.ref && (
            <button className="shrink-0 font-medium text-accent hover:underline" onClick={() => onOpen(e.ref!)}>
              {t("Open")}
            </button>
          )}
        </div>
      );
    case "error":
      return <div className="text-danger">{e.message}</div>;
    case "done":
      return e.costUsd !== undefined && e.costUsd > 0 ? <div className="text-right text-[11px] text-faint">${e.costUsd.toFixed(2)}</div> : null;
    case "phase":
      return null;
  }
}
