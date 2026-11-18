import { useCallback, useEffect, useState } from "react";
import type { DemoRef, DemoStatus, DemoSummary, LibraryClient } from "@common/types";
import { api } from "../api";
import { timeAgo } from "../format";
import { NewDemoDialog } from "./NewDemoDialog";

const STATUS_LABEL: Record<DemoStatus, string> = {
  draft: "Draft",
  "in-review": "In client review",
  feedback: "Feedback received",
  approved: "Approved",
  exported: "Exported",
};

const STATUS_CLASS: Record<DemoStatus, string> = {
  draft: "bg-black/5 text-muted",
  "in-review": "bg-accent-soft text-accent",
  feedback: "bg-warn/15 text-warn",
  approved: "bg-ok/15 text-ok",
  exported: "bg-ok/15 text-ok",
};

export function Library(props: { onOpen: (ref: DemoRef, autostart?: { structureFirst: boolean }) => void; onSettings: () => void }) {
  const [clients, setClients] = useState<LibraryClient[] | undefined>();
  const [newDemo, setNewDemo] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(() => void api.library.list().then(setClients), []);
  useEffect(load, [load]);
  useEffect(() => api.onDemoChanged(() => load()), [load]);

  const q = query.trim().toLowerCase();
  const visible = (clients ?? [])
    .map((c) => ({
      ...c,
      demos: c.name.toLowerCase().includes(q) ? c.demos : c.demos.filter((d) => d.name.toLowerCase().includes(q)),
    }))
    .filter((c) => !q || c.demos.length > 0 || c.name.toLowerCase().includes(q));

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-line bg-panel pr-4 pl-24">
        <h1 className="text-[14px] font-semibold">Prototyper</h1>
        <div className="no-drag ml-auto flex items-center gap-2">
          <input className="input w-56" placeholder="Search clients and demos" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn btn-ghost" onClick={props.onSettings} aria-label="Settings">
            Settings
          </button>
          <button className="btn btn-primary" onClick={() => setNewDemo(true)}>
            New demo
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {clients === undefined ? null : clients.length === 0 ? (
          <EmptyState onCreate={() => setNewDemo(true)} />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-9">
            {visible.map((client) => (
              <section key={client.slug}>
                <div className="mb-3 flex items-baseline gap-3">
                  <h2 className="text-[15px] font-semibold">{client.name}</h2>
                  {client.website && <span className="truncate text-faint">{client.website.replace(/^https?:\/\//, "")}</span>}
                  <span className="text-faint">· {client.demos.length} {client.demos.length === 1 ? "demo" : "demos"}</span>
                </div>
                {client.demos.length === 0 ? (
                  <p className="text-muted">No demos yet.</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                    {client.demos.map((d) => (
                      <DemoCard key={d.slug} demo={d} onOpen={() => props.onOpen({ client: client.slug, demo: d.slug })} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      {newDemo && (
        <NewDemoDialog
          clients={clients ?? []}
          onClose={() => setNewDemo(false)}
          onCreated={(ref, structureFirst) => {
            setNewDemo(false);
            props.onOpen(ref, { structureFirst });
          }}
        />
      )}
    </div>
  );
}

function DemoCard({ demo, onOpen }: { demo: DemoSummary; onOpen: () => void }) {
  const version = demo.versions.at(-1);
  return (
    <button
      onClick={onOpen}
      className="group overflow-hidden rounded-lg border border-line bg-panel text-left transition-shadow hover:shadow-md"
    >
      <div className="aspect-[16/10] overflow-hidden border-b border-line bg-canvas">
        {demo.thumbnail ? (
          <img src={demo.thumbnail} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="grid h-full place-items-center text-faint">No preview yet</div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{demo.name}</span>
          {version && <span className="text-faint">v{version.number}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[demo.status]}`}>{STATUS_LABEL[demo.status]}</span>
          <span className="ml-auto text-[12px] text-faint">{timeAgo(demo.updatedAt)}</span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <h2 className="text-[17px] font-semibold">Your demo library is empty</h2>
      <p className="mt-2 text-muted">
        Create a demo from a brief. Claude builds a first version you can preview here, then share with your client for feedback.
      </p>
      <button className="btn btn-primary mt-5" onClick={onCreate}>
        Create your first demo
      </button>
    </div>
  );
}
