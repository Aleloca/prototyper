import { useEffect, useMemo, useState } from "react";
import { api, type ProjectSummary, type WorkspaceView } from "../api";
import { Badge, CopyButton, ErrorText, Loading, roundState } from "../components/ui";
import { errorMessage, timeAgo } from "../format";
import { useT } from "../i18n";
import { Link } from "../router";

export function Projects({ workspaceId, isAdmin }: { workspaceId: string; isAdmin: boolean }) {
  const t = useT();
  const [data, setData] = useState<WorkspaceView | undefined>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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

  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const visible = data.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.client?.name ?? "").toLowerCase().includes(q));
    const byClient = new Map<string, ProjectSummary[]>();
    for (const p of visible) {
      const k = p.client?.name ?? "—";
      byClient.set(k, [...(byClient.get(k) ?? []), p]);
    }
    return [...byClient.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, query]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;

  const toImport = data.projects.filter((p) => p.round?.status === "submitted").length;
  const activeDomains = data.domains.filter((d) => d.status === "active");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold">{data.workspace.name}</h1>
          <p className="text-muted">
            {t("{n} projects", { n: data.projects.length })}
            {toImport > 0 && <> · <span className="font-medium text-warn">{t("{n} with feedback to import", { n: toImport })}</span></>}
          </p>
        </div>
        {data.projects.length > 0 && (
          <input className="input w-full max-w-64" type="search" placeholder={t("Search projects and clients")} value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>

      {activeDomains.length === 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[13.5px]">
          {t("This workspace has no active preview domain yet, so nothing can be published.")}{" "}
          {isAdmin ? (
            <Link to="/admin?tab=domains" className="font-medium text-accent hover:underline">
              {t("Add a domain")}
            </Link>
          ) : (
            t("Ask an admin to add one.")
          )}
        </div>
      )}

      {data.projects.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[16px] font-medium">{t("No projects yet")}</p>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {t("Projects are created from Claude Code. In your project, ask Claude to publish the prototype on Prototyper: the link and its versions will show up here.")}
          </p>
        </div>
      ) : (
        groups.map(([client, projects]) => (
          <section key={client}>
            <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{client}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const t = useT();
  const state = roundState(p);
  return (
    <div className="card flex flex-col transition-shadow hover:shadow-md">
      <Link to={`/p/${p.id}`} className="flex flex-1 flex-col gap-2 px-4 pt-4 pb-3">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
          {p.latestVersion && <span className="shrink-0 text-[13px] text-faint">v{p.latestVersion.number}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{t(state.label)}</Badge>
          {p.round && p.round.edits + p.round.comments > 0 && (
            <span className="text-[12.5px] text-muted">{t("{e} edits · {c} notes", { e: p.round.edits, c: p.round.comments })}</span>
          )}
        </div>
        <span className="mt-auto text-[12.5px] text-faint">{t("Updated {ago}", { ago: timeAgo(p.updatedAt, t) })}</span>
      </Link>
      {p.url && p.shareStatus !== "revoked" && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{p.url.replace(/^https:\/\//, "")}</span>
          <CopyButton text={p.url} label={t("Copy link")} />
        </div>
      )}
    </div>
  );
}
