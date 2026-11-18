import { useCallback, useEffect, useState } from "react";
import type { DemoRef, ReferenceItem } from "@common/types";
import { api } from "../api";
import { errorMessage } from "../format";
import { useT } from "../i18n";

/** Reference images of a demo: drop or paste images, capture websites, add a note to each. */
export function ReferencesPanel({ demoRef }: { demoRef: DemoRef }) {
  const t = useT();
  const [items, setItems] = useState<ReferenceItem[] | undefined>();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [over, setOver] = useState(false);

  const load = useCallback(() => void api.demo.references(demoRef).then(setItems), [demoRef]);
  useEffect(load, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  // Paste an image from the clipboard anywhere while this panel is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void run(t("Adding pasted image…"), async () => {
        const ext = file.type.split("/")[1] ?? "png";
        await api.demo.addReferenceImage(demoRef, new Uint8Array(await file.arrayBuffer()), ext === "jpeg" ? "jpg" : ext);
      });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRef]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) void run(t("Adding images…"), () => api.demo.addReferenceFiles(demoRef, paths));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p className="mb-3 text-muted">{t("Images Claude looks at when building or changing the demo. Say what to take from each one.")}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed px-3 py-5 text-center transition-colors ${over ? "border-accent bg-accent-soft" : "border-line"}`}
      >
        <p className="font-medium">{t("Drop screenshots here")}</p>
        <p className="text-[12px] text-faint">{t("or paste an image (⌘V)")}</p>
      </div>

      <div className="mt-3 flex gap-2">
        <input className="input" placeholder="https://site-you-like.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && void run(t("Capturing {url}…", { url }), async () => { await api.demo.addReferenceUrl(demoRef, url, ""); setUrl(""); })} />
        <button
          className="btn shrink-0"
          disabled={!url.trim() || !!busy}
          onClick={() =>
            void run(t("Capturing {url}…", { url }), async () => {
              await api.demo.addReferenceUrl(demoRef, url, "");
              setUrl("");
            })
          }
        >
          {t("Capture")}
        </button>
      </div>

      {busy && <p className="mt-2 text-muted">{busy}</p>}
      {error && <p className="mt-2 text-danger">{error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {items?.map((r) => (
          <li key={r.file} className="overflow-hidden rounded-lg border border-line">
            {r.thumbnail && <img src={r.thumbnail} alt="" className="max-h-40 w-full border-b border-line object-cover object-top" />}
            <div className="px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[12px] text-muted">{r.source ?? r.file}</span>
                <button className="ml-auto text-[12px] text-danger hover:underline" onClick={() => void run(t("Removing…"), () => api.demo.removeReference(demoRef, r.file))}>
                  {t("Remove")}
                </button>
              </div>
              <textarea
                className="input mt-1.5 min-h-14 resize-y"
                placeholder={t("What to take from it: “this hero layout”, “colors no, typography yes”…")}
                defaultValue={r.note}
                onBlur={(e) => e.target.value !== r.note && void api.demo.setReferenceNote(demoRef, r.file, e.target.value)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
