import { useEffect, useMemo, useState } from "react";
import { api, type ProjectSummary, type WorkspaceView } from "../api";
import { Check, Copy, Search } from "../components/icons";
import { ClientChip, ErrorText, Mark, StateLabel, roundState, swatchCode, type MarkKind } from "../components/ui";
import { copy, errorMessage, timeAgo } from "../format";
import { useT } from "../i18n";
import { Link } from "../router";
import { spotFor } from "../swatch";

type Filter = "all" | "attention" | "waiting" | "done";
const FILTER_MARKS: Record<Exclude<Filter, "all">, MarkKind[]> = {
  attention: ["attention"],
  waiting: ["waiting", "reviewing"],
  done: ["done", "off", "none"],
};

export function Projects({ workspaceId, isAdmin }: { workspaceId: string; isAdmin: boolean }) {
  const t = useT();
  const [data, setData] = useState<WorkspaceView | undefined>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<WorkspaceView>(`/api/panel/workspaces/${workspaceId}`)
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(errorMessage(e)));
    void load();
    // Clients review while the panel is open: refresh now and then.
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [workspaceId]);

  const counts = useMemo(() => {
    const c = { attention: 0, waiting: 0, done: 0 };
    for (const p of data?.projects ?? []) {
      const m = roundState(p).mark;
      if (m === "attention") c.attention++;
      else if (m === "waiting" || m === "reviewing") c.waiting++;
      else c.done++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.projects ?? [])
      .filter((p) => !client || p.client?.id === client)
      .filter((p) => filter === "all" || FILTER_MARKS[filter].includes(roundState(p).mark))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.client?.name ?? "").toLowerCase().includes(q))
      .sort((a, b) => {
        // What needs the team first, then most recent activity.
        const rank = (p: ProjectSummary) => ({ attention: 0, reviewing: 1, waiting: 2, done: 3, none: 4, off: 5 })[roundState(p).mark];
        return rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [data, query, client, filter]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ProjectsSkeleton />;

  const activeDomains = data.domains.filter((d) => d.status === "active");
  const perClient = (id: string) => data.projects.filter((p) => p.client?.id === id).length;

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-7 lg:sticky lg:top-[88px] lg:flex lg:self-start">
        <div>
          <h2 className="caps mb-2 text-faint">{t("Clients")}</h2>
          {data.clients.length === 0 ? (
            <p className="text-[13px] text-faint">{t("Clients appear with their first project.")}</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              <li>
                <RailButton active={!client} onClick={() => setClient(null)} label={t("All clients")} count={data.projects.length} />
              </li>
              {data.clients.map((c) => (
                <li key={c.id}>
                  <RailButton active={client === c.id} onClick={() => setClient(client === c.id ? null : c.id)} label={c.name} count={perClient(c.id)} chip={<ClientChip swatch={c.swatch} />} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">{t("Projects")}</h1>
            <p className="mt-1 text-muted">
              {t("{n} projects for {c} clients", { n: data.projects.length, c: data.clients.length })}
              {counts.attention > 0 && (
                <>
                  {" · "}
                  <button type="button" className="font-semibold text-attention underline-offset-3 hover:underline" onClick={() => setFilter("attention")}>
                    {t("{n} with feedback to import", { n: counts.attention })}
                  </button>
                </>
              )}
            </p>
          </div>
          {data.projects.length > 0 && (
            <label className="relative w-full sm:w-72">
              <span className="sr-only">{t("Search projects and clients")}</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input className="input pl-9" type="search" placeholder={t("Search projects and clients")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>

        {data.projects.length > 0 && (
          <div className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <div className="seg" role="group" aria-label={t("Review state")}>
              {(
                [
                  ["all", t("All"), data.projects.length, null],
                  ["attention", t("To import"), counts.attention, "attention"],
                  ["waiting", t("With the client"), counts.waiting, "waiting"],
                  ["done", t("Imported or closed"), counts.done, "done"],
                ] as const
              ).map(([key, label, n, mark]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className="inline-flex items-center gap-2 whitespace-nowrap">
                  {mark && <Mark kind={mark} className={filter === key ? "!text-white" : ""} />}
                  {label}
                  <span className={`num ${filter === key ? "text-white/70" : "text-faint"}`}>{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {data.clients.length > 1 && (
          <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden" role="group" aria-label={t("Clients")}>
            {data.clients.map((c) => (
              <MobileFilter key={c.id} active={client === c.id} onClick={() => setClient(client === c.id ? null : c.id)}>
                <ClientChip swatch={c.swatch} size={12} />
                {c.name}
              </MobileFilter>
            ))}
          </div>
        )}

        {activeDomains.length === 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] bg-attention-wash px-4 py-3 text-[13.5px] text-ink-2">
            <Mark kind="attention" />
            <span className="flex-1">{t("This workspace has no active preview domain yet, so nothing can be published.")}</span>
            {isAdmin ? (
              <Link to="/admin?tab=domains" className="font-semibold text-ink underline underline-offset-3">
                {t("Add a domain")}
              </Link>
            ) : (
              <span>{t("Ask an admin to add one.")}</span>
            )}
          </div>
        )}

        {data.projects.length === 0 ? (
          <EmptyWorkspace />
        ) : visible.length === 0 ? (
          <div className="rounded-[4px] border border-dashed border-line-strong px-6 py-14 text-center">
            <p className="font-semibold">{t("No project matches")}</p>
            <button
              type="button"
              className="btn mt-4"
              onClick={() => {
                setQuery("");
                setClient(null);
                setFilter("all");
              }}
            >
              {t("Show all projects")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-5">
            {visible.map((p) => (
              <li key={p.id}>
                <ProjectChip project={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={done ? t("Copied") : label}
      aria-label={done ? t("Copied") : label}
      onClick={() =>
        void copy(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        })
      }
      className="relative z-10 -mr-1.5 grid size-8 place-items-center rounded-[3px] text-ink-2 transition-colors duration-150 hover:bg-ink/[.06] hover:text-ink"
    >
      {done ? <Check aria-hidden className="size-4 text-done" /> : <Copy aria-hidden className="size-4" />}
    </button>
  );
}

function MobileFilter(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[4px] border px-3 text-[13.5px] font-medium whitespace-nowrap ${props.active ? "border-ink bg-ink/[.06]" : "border-line-strong bg-stock"}`}
    >
      {props.children}
    </button>
  );
}

function RailButton(props: { active: boolean; onClick: () => void; label: string; count: number; chip?: React.ReactNode; tone?: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left text-[14px] transition-colors duration-150 ${props.active ? "bg-ink/[.06] font-semibold" : "hover:bg-ink/[.04]"} ${props.tone ?? ""}`}
    >
      {props.chip ?? <span className="size-[14px] shrink-0" />}
      <span className="min-w-0 flex-1 truncate text-ink">{props.label}</span>
      <span className="num text-[13px] text-faint">{props.count}</span>
    </button>
  );
}

/** A project as a swatch: the client's spot colour, then the printed label strip. */
function ProjectChip({ project: p }: { project: ProjectSummary }) {
  const t = useT();
  const spot = spotFor(p.client?.swatch);
  const state = roundState(p);
  const r = p.round;
  const activity =
    r && r.edits + r.comments > 0
      ? [r.edits ? t(r.edits === 1 ? "1 edit" : "{n} edits", { n: r.edits }) : "", r.comments ? t(r.comments === 1 ? "1 note" : "{n} notes", { n: r.comments }) : ""].filter(Boolean).join(" · ")
      : p.latestVersion
        ? t("No feedback yet")
        : t("No version yet");
  return (
    <article className="group relative flex h-full flex-col rounded-[var(--radius-chip)] bg-stock shadow-[var(--shadow-chip)] transition-[box-shadow,transform] duration-200 ease-out focus-within:shadow-[var(--shadow-lift)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <div className="flex h-[148px] flex-col justify-between rounded-t-[var(--radius-chip)] p-4" style={{ background: spot.bg, color: spot.fg }}>
        <div className="flex items-start justify-between gap-2">
          <span className="caps num" style={{ color: spot.fg2 }}>
            {swatchCode(p.client?.name, p.number)}
          </span>
          {p.latestVersion && (
            <span className="caps num" style={{ color: spot.fg2 }}>
              v{p.latestVersion.number}
            </span>
          )}
        </div>
        <div>
          <p className="truncate text-[12.5px] font-medium" style={{ color: spot.fg2 }}>
            {p.client?.name}
          </p>
          <h3 className="line-clamp-2 text-[19px] leading-[1.15] font-bold tracking-[-0.015em]">
            <Link to={`/p/${p.id}`} className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius-chip)] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus">
              {p.name}
            </Link>
          </h3>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-4 pt-3 pb-2.5">
        <StateLabel kind={state.mark}>{t(state.label)}</StateLabel>
        <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
          <span className="truncate">{activity}</span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="num text-faint">{timeAgo(p.updatedAt, t)}</span>
            {p.url && p.shareStatus !== "revoked" && <CopyIconButton text={p.url} label={t("Copy client link")} />}
          </span>
        </div>
      </div>
    </article>
  );
}

function EmptyWorkspace() {
  const t = useT();
  return (
    <div className="grid gap-8 rounded-[4px] bg-stock p-8 shadow-[var(--shadow-chip)] md:grid-cols-[1fr_280px] md:items-center">
      <div>
        <h2 className="text-[19px] font-bold tracking-[-0.01em]">{t("No projects yet")}</h2>
        <p className="mt-2 max-w-[56ch] text-muted">
          {t("Projects are created from Claude Code. In your project, ask Claude to publish the prototype on Prototyper: the link and its versions will show up here.")}
        </p>
        <p className="mt-4 rounded-[4px] bg-wash px-3 py-2 text-[13.5px] text-ink-2">“{t("Create the preview on Prototyper for the client Studio Rossi")}”</p>
      </div>
      <div className="flex gap-2" aria-hidden>
        {["#C84C28", "#2B7DA0", "#F2C14E"].map((c, i) => (
          <div key={c} className="flex-1 rounded-[3px] bg-stock shadow-[var(--shadow-chip)]" style={{ transform: `rotate(${(i - 1) * 4}deg)` }}>
            <div className="h-24 rounded-t-[3px]" style={{ background: c }} />
            <div className="space-y-1.5 p-2">
              <div className="h-1.5 w-3/4 rounded-full bg-line" />
              <div className="h-1.5 w-1/2 rounded-full bg-line" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]" aria-busy>
      <div className="hidden flex-col gap-3 lg:flex">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-5" />
        ))}
      </div>
      <div>
        <div className="skeleton mb-2 h-8 w-64" />
        <div className="skeleton mb-8 h-4 w-48" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[230px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
