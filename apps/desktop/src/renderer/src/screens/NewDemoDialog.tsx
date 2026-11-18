import { useState } from "react";
import type { DemoRef, GenerateOptions, LibraryClient } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage } from "../format";
import { useT } from "../i18n";

const NEW_CLIENT = "__new__";
const LANGUAGES = ["Italian", "English", "German", "French", "Spanish"];
const DEFAULT_PAGES = ["Home"];

export function NewDemoDialog(props: {
  clients: LibraryClient[];
  onClose: () => void;
  onCreated: (ref: DemoRef, options: GenerateOptions) => void;
}) {
  const t = useT();
  const [client, setClient] = useState(props.clients[0]?.slug ?? NEW_CLIENT);
  const [clientName, setClientName] = useState("");
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("Italian");
  const [pages, setPages] = useState<string[]>(DEFAULT_PAGES);
  const [pageDraft, setPageDraft] = useState("");
  const [brief, setBrief] = useState("");
  const [structureFirst, setStructureFirst] = useState(false);
  const [extractBrand, setExtractBrand] = useState(true);
  const [refFiles, setRefFiles] = useState<{ path: string; name: string }[]>([]);
  const [refUrls, setRefUrls] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isNewClient = client === NEW_CLIENT;
  const existing = props.clients.find((c) => c.slug === client);
  const hasBrand = !isNewClient && !!existing?.hasBrand;
  const brandSite = isNewClient ? website.trim() : existing?.website ?? "";
  const canCreate = name.trim() && brief.trim() && (!isNewClient || clientName.trim()) && pages.length > 0;

  const addPage = () => {
    const p = pageDraft.trim().replace(/,$/, "");
    if (p && !pages.includes(p)) setPages([...pages, p]);
    setPageDraft("");
  };

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const slug = isNewClient ? (await api.library.createClient({ name: clientName, website })).slug : client;
      const meta = await api.demo.create({
        client: slug,
        name,
        language,
        pages,
        brief,
        structureFirst,
        references: refFiles.map((f) => ({ path: f.path, note: "" })),
      });
      const urls = refUrls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
      props.onCreated(
        { client: slug, demo: meta.slug },
        { structureFirst, extractBrand: !hasBrand && !!brandSite && extractBrand, ...(urls.length ? { referenceUrls: urls } : {}) },
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("New demo")}
      width="max-w-2xl"
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-danger">{error}</span>}
          <button className="btn" onClick={props.onClose}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" disabled={!canCreate || busy} onClick={() => void create()}>
            {t(busy ? "Creating…" : structureFirst ? "Create and propose structure" : "Create and generate")}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className={isNewClient ? "" : "col-span-2"}>
          <label className="label" htmlFor="nd-client">{t("Client")}</label>
          <select id="nd-client" className="input" value={client} onChange={(e) => setClient(e.target.value)}>
            {props.clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>{t("+ New client…")}</option>
          </select>
        </div>
        {isNewClient && (
          <div>
            <label className="label" htmlFor="nd-client-name">{t("Client name")}</label>
            <input id="nd-client-name" className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Studio Rossi" autoFocus />
          </div>
        )}
        {isNewClient && (
          <div className="col-span-2">
            <label className="label" htmlFor="nd-website">{t("Client website (optional, used later for brand extraction)")}</label>
            <input id="nd-website" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="nd-name">{t("Demo name")}</label>
          <input id="nd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Landing page 2027" autoFocus={!isNewClient} />
        </div>
        <div>
          <label className="label" htmlFor="nd-lang">{t("Content language")}</label>
          <input id="nd-lang" className="input" list="nd-languages" value={language} onChange={(e) => setLanguage(e.target.value)} />
          <datalist id="nd-languages">
            {LANGUAGES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>

        <div className="col-span-2">
          <label className="label" htmlFor="nd-pages">{t("Pages")}</label>
          <div className="input flex flex-wrap items-center gap-1.5 py-1">
            {pages.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded bg-accent-soft py-0.5 pr-1 pl-2 text-accent">
                {p}
                <button className="rounded px-1 hover:bg-accent/10" aria-label={`Remove ${p}`} onClick={() => setPages(pages.filter((x) => x !== p))}>
                  ×
                </button>
              </span>
            ))}
            <input
              id="nd-pages"
              className="min-w-32 flex-1 bg-transparent py-0.5 outline-none placeholder:text-faint"
              value={pageDraft}
              placeholder={pages.length ? t("Add a page…") : "Home, About, Services, Contact"}
              onChange={(e) => setPageDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addPage();
                } else if (e.key === "Backspace" && !pageDraft && pages.length) setPages(pages.slice(0, -1));
              }}
              onBlur={addPage}
            />
          </div>
        </div>

        <div className="col-span-2">
          <label className="label" htmlFor="nd-brief">{t("Brief")}</label>
          <textarea
            id="nd-brief"
            className="input min-h-44 resize-y leading-relaxed"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t("Who the client is, who the site is for, what it must achieve, key messages, tone… Paste emails or meeting notes as they are.")}
          />
        </div>

        <div className="col-span-2">
          <span className="label">{t("Brand")}</span>
          {hasBrand ? (
            <p className="text-muted">{t("Uses the brand saved for {name}. Edit it from the library (Brand).", { name: existing?.name ?? "" })}</p>
          ) : brandSite ? (
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5" checked={extractBrand} onChange={(e) => setExtractBrand(e.target.checked)} />
              <span>
                <span className="font-medium">{t("Extract the brand from {site} first", { site: brandSite.replace(/^https?:\/\//, "") })}</span>
                <span className="block text-muted">{t("Colors, fonts, logo and tone of voice from the client's current site. Adds a couple of minutes.")}</span>
              </span>
            </label>
          ) : (
            <p className="text-muted">{t("No website for this client: Claude will propose a style from the brief.")}</p>
          )}
        </div>

        <div className="col-span-2">
          <span className="label">{t("References (optional)")}</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const files = Array.from(e.dataTransfer.files)
                .filter((f) => f.type.startsWith("image/"))
                .map((f) => ({ path: api.pathForFile(f), name: f.name }));
              setRefFiles((prev) => [...prev, ...files.filter((f) => f.path && !prev.some((p) => p.path === f.path))]);
            }}
            className={`rounded-md border-2 border-dashed px-3 py-3 text-center ${over ? "border-accent bg-accent-soft" : "border-line"}`}
          >
            {refFiles.length ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {refFiles.map((f) => (
                  <span key={f.path} className="inline-flex items-center gap-1 rounded bg-canvas py-0.5 pr-1 pl-2 text-[12px]">
                    {f.name}
                    <button className="rounded px-1 hover:bg-black/5" aria-label={`Remove ${f.name}`} onClick={() => setRefFiles(refFiles.filter((x) => x.path !== f.path))}>×</button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted">{t("Drop screenshots of pages you like")}</span>
            )}
          </div>
          <input
            className="input mt-2"
            value={refUrls}
            onChange={(e) => setRefUrls(e.target.value)}
            placeholder={t("…or websites to capture, separated by spaces: https://a.com https://b.com")}
          />
          <p className="mt-1 text-[12px] text-faint">{t("You can add notes to each reference later, in the demo's References tab.")}</p>
        </div>

        <label className="col-span-2 flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5" checked={structureFirst} onChange={(e) => setStructureFirst(e.target.checked)} />
          <span>
            <span className="font-medium">{t("Show me the structure first")}</span>
            <span className="block text-muted">{t("Claude proposes the sitemap and sections; it builds the pages after you approve.")}</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
