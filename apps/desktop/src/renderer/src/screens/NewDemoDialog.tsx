import { useState } from "react";
import type { DemoRef, LibraryClient } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage } from "../format";

const NEW_CLIENT = "__new__";
const LANGUAGES = ["Italian", "English", "German", "French", "Spanish"];
const DEFAULT_PAGES = ["Home"];

export function NewDemoDialog(props: {
  clients: LibraryClient[];
  onClose: () => void;
  onCreated: (ref: DemoRef, structureFirst: boolean) => void;
}) {
  const [client, setClient] = useState(props.clients[0]?.slug ?? NEW_CLIENT);
  const [clientName, setClientName] = useState("");
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("Italian");
  const [pages, setPages] = useState<string[]>(DEFAULT_PAGES);
  const [pageDraft, setPageDraft] = useState("");
  const [brief, setBrief] = useState("");
  const [structureFirst, setStructureFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isNewClient = client === NEW_CLIENT;
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
      const meta = await api.demo.create({ client: slug, name, language, pages, brief, structureFirst });
      props.onCreated({ client: slug, demo: meta.slug }, structureFirst);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New demo"
      width="max-w-2xl"
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-danger">{error}</span>}
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canCreate || busy} onClick={() => void create()}>
            {busy ? "Creating…" : structureFirst ? "Create and propose structure" : "Create and generate"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className={isNewClient ? "" : "col-span-2"}>
          <label className="label" htmlFor="nd-client">Client</label>
          <select id="nd-client" className="input" value={client} onChange={(e) => setClient(e.target.value)}>
            {props.clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>+ New client…</option>
          </select>
        </div>
        {isNewClient && (
          <div>
            <label className="label" htmlFor="nd-client-name">Client name</label>
            <input id="nd-client-name" className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Studio Rossi" autoFocus />
          </div>
        )}
        {isNewClient && (
          <div className="col-span-2">
            <label className="label" htmlFor="nd-website">Client website (optional, used later for brand extraction)</label>
            <input id="nd-website" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="nd-name">Demo name</label>
          <input id="nd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Landing page 2027" autoFocus={!isNewClient} />
        </div>
        <div>
          <label className="label" htmlFor="nd-lang">Content language</label>
          <input id="nd-lang" className="input" list="nd-languages" value={language} onChange={(e) => setLanguage(e.target.value)} />
          <datalist id="nd-languages">
            {LANGUAGES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>

        <div className="col-span-2">
          <label className="label" htmlFor="nd-pages">Pages</label>
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
              placeholder={pages.length ? "Add a page…" : "Home, About, Services, Contact"}
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
          <label className="label" htmlFor="nd-brief">Brief</label>
          <textarea
            id="nd-brief"
            className="input min-h-44 resize-y leading-relaxed"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Who the client is, who the site is for, what it must achieve, key messages, tone… Paste emails or meeting notes as they are."
          />
        </div>

        <label className="col-span-2 flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5" checked={structureFirst} onChange={(e) => setStructureFirst(e.target.checked)} />
          <span>
            <span className="font-medium">Show me the structure first</span>
            <span className="block text-muted">Claude proposes the sitemap and sections; it builds the pages after you approve.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
