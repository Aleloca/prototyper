import { useEffect, useRef, useState } from "react";
import type { BrandInfo, BrandTokens, RunEvent } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage, timeAgo } from "../format";

const COLOR_LABELS: Record<string, string> = {
  "--color-primary": "Primary",
  "--color-primary-contrast": "Text on primary",
  "--color-accent": "Accent",
  "--color-ink": "Text",
  "--color-muted": "Muted text",
  "--color-surface": "Background",
  "--color-surface-alt": "Alt background",
  "--color-line": "Lines",
};
const OTHER_LABELS: Record<string, string> = {
  "--font-heading": "Heading font",
  "--font-body": "Body font",
  "--radius-brand": "Corner radius",
};

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v.trim());

/** Brand of a client: extraction from their website, editable tokens and guidelines. */
export function BrandDialog(props: { client: string; onClose: () => void }) {
  const [info, setInfo] = useState<BrandInfo | undefined>();
  const [website, setWebsite] = useState("");
  const [tokens, setTokens] = useState<BrandTokens>({});
  const [brandMd, setBrandMd] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [zoom, setZoom] = useState<string | undefined>();
  const logEnd = useRef<HTMLDivElement>(null);

  const load = async () => {
    const i = await api.brand.info(props.client);
    setInfo(i);
    setWebsite((w) => w || i.website || "");
    setTokens(i.tokens);
    setBrandMd(i.brandMd);
    setDirty(false);
  };

  useEffect(() => {
    void load();
    return api.onBrandEvent(({ client, event }) => {
      if (client !== props.client) return;
      const line = describe(event);
      if (line) setLog((l) => [...l, line]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client]);

  useEffect(() => logEnd.current?.scrollIntoView({ block: "end" }), [log.length]);

  const extract = async () => {
    setExtracting(true);
    setError(undefined);
    setLog([]);
    try {
      const ok = await api.brand.extract(props.client, website);
      if (!ok) setError("The extraction did not complete. See the log above.");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setError(undefined);
    try {
      await api.brand.saveTokens(props.client, tokens);
      await api.brand.saveMd(props.client, brandMd);
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const setToken = (name: string, value: string) => {
    setTokens((t) => ({ ...t, [name]: value }));
    setDirty(true);
  };

  return (
    <Modal
      title={info ? `Brand — ${info.clientName}` : "Brand"}
      width="max-w-5xl"
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-danger">{error}</span>}
          <button className="btn" onClick={props.onClose}>Close</button>
          {info?.hasBrand && (
            <button className="btn btn-primary" disabled={!dirty || extracting} onClick={() => void save()}>
              Save changes
            </button>
          )}
        </>
      }
    >
      {info && (
        <div className="flex flex-col gap-6">
          <section>
            <label className="label" htmlFor="br-site">Client website</label>
            <div className="flex gap-2">
              <input id="br-site" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" disabled={extracting} />
              <button className="btn btn-primary shrink-0" disabled={!website.trim() || extracting} onClick={() => void extract()}>
                {extracting ? "Extracting…" : info.hasBrand ? "Extract again" : "Extract brand"}
              </button>
            </div>
            <p className="mt-1 text-[12px] text-faint">
              Reads the home page and up to three inner pages: colors, fonts, buttons, logo, tone of voice and screenshots. Claude turns them into guidelines. Takes a couple of minutes.
              {info.extractedAt && ` Last extracted ${timeAgo(info.extractedAt)}.`}
            </p>
            {log.length > 0 && (
              <div className="mt-2 max-h-36 overflow-y-auto rounded-md bg-canvas px-3 py-2 font-mono text-[11.5px] text-muted">
                {log.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                <div ref={logEnd} />
              </div>
            )}
          </section>

          {info.hasBrand ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6">
              <div className="flex flex-col gap-5">
                <section>
                  <h3 className="mb-2 font-semibold">Colors</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(COLOR_LABELS).map((name) => (
                      <label key={name} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                        <input
                          type="color"
                          className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                          value={isHex(tokens[name] ?? "") ? tokens[name] : "#000000"}
                          onChange={(e) => setToken(name, e.target.value)}
                          aria-label={COLOR_LABELS[name]}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] text-muted">{COLOR_LABELS[name]}</span>
                          <input className="w-full bg-transparent font-mono text-[12px] outline-none" value={tokens[name] ?? ""} onChange={(e) => setToken(name, e.target.value)} />
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  {Object.entries(OTHER_LABELS).map(([name, label]) => (
                    <div key={name}>
                      <label className="label" htmlFor={`br-${name}`}>{label}</label>
                      <input id={`br-${name}`} className="input font-mono text-[12px]" value={tokens[name] ?? ""} onChange={(e) => setToken(name, e.target.value)} />
                    </div>
                  ))}
                </section>
                <section>
                  <h3 className="mb-2 font-semibold">Preview</h3>
                  <BrandPreview tokens={tokens} logo={info.logo} name={info.clientName} />
                </section>
              </div>

              <div className="flex min-w-0 flex-col gap-5">
                <section>
                  <label className="label" htmlFor="br-md">Guidelines (BRAND.md) — Claude follows these when building demos</label>
                  <textarea
                    id="br-md"
                    className="input h-80 resize-y font-mono text-[12px] leading-relaxed"
                    value={brandMd}
                    onChange={(e) => {
                      setBrandMd(e.target.value);
                      setDirty(true);
                    }}
                  />
                </section>
                {info.screenshots.length > 0 && (
                  <section>
                    <h3 className="mb-2 font-semibold">Screenshots</h3>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {info.screenshots.map((s, i) => (
                        <button key={i} className="shrink-0" onClick={() => setZoom(s)} aria-label={`Screenshot ${i + 1}`}>
                          <img src={s} alt="" className="h-28 w-auto rounded border border-line object-cover object-top" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          ) : (
            !extracting && <p className="text-muted">No brand yet. Extract it from the client's website, or create demos without one: Claude will propose a style.</p>
          )}
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/70 p-8" onClick={() => setZoom(undefined)}>
          <img src={zoom} alt="" className="mx-auto max-w-3xl rounded-lg shadow-2xl" />
        </div>
      )}
    </Modal>
  );
}

/** A tiny mock section rendered with the brand tokens. */
function BrandPreview({ tokens, logo, name }: { tokens: BrandTokens; logo: string | undefined; name: string }) {
  const t = (k: string, fallback: string) => tokens[k] || fallback;
  return (
    <div className="overflow-hidden rounded-lg border border-line" style={{ background: t("--color-surface", "#fff"), color: t("--color-ink", "#111"), fontFamily: t("--font-body", "system-ui") }}>
      <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: t("--color-line", "#ddd") }}>
        {logo ? <img src={logo} alt="" className="h-6 w-auto" /> : <span className="font-semibold">{name}</span>}
      </div>
      <div className="px-4 py-4" style={{ background: t("--color-surface-alt", "#f5f5f5") }}>
        <div style={{ fontFamily: t("--font-heading", "serif"), fontSize: 22, lineHeight: 1.15 }}>A headline in the brand</div>
        <p className="mt-1 text-[13px]" style={{ color: t("--color-muted", "#666") }}>
          Body copy in the brand font, with <span style={{ color: t("--color-accent", "#c60") }}>an accent</span>.
        </p>
        <span className="mt-3 inline-block px-3 py-1.5 text-[13px] font-medium" style={{ background: t("--color-primary", "#333"), color: t("--color-primary-contrast", "#fff"), borderRadius: t("--radius-brand", "6px") }}>
          Primary button
        </span>
      </div>
    </div>
  );
}

function describe(e: RunEvent): string | undefined {
  switch (e.type) {
    case "phase":
      return e.message;
    case "assistant":
      return e.text.split("\n")[0];
    case "tool":
      return `  ${e.name} ${e.detail}`;
    case "error":
      return `Error: ${e.message}`;
    case "result":
      return e.ok ? `Done${e.durationMs ? ` in ${Math.round(e.durationMs / 1000)}s` : ""}` : `Failed: ${e.text}`;
    default:
      return undefined;
  }
}
