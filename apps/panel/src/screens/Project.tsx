import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type ContentValue, type Feedback, type ProjectDetail } from "../api";
import { Modal } from "../components/Modal";
import { Badge, CopyButton, ErrorText, Loading, Spinner, roundState } from "../components/ui";
import { errorMessage, formatDate, timeAgo } from "../format";
import { useT } from "../i18n";
import { Link, navigate, useLocation } from "../router";

type Tab = "preview" | "feedback";

export function ProjectScreen({ id, onWorkspace }: { id: string; onWorkspace: (workspaceId: string) => void }) {
  const t = useT();
  const { search } = useLocation();
  const [p, setP] = useState<ProjectDetail | undefined>();
  const [error, setError] = useState("");
  const tab: Tab = search.get("tab") === "feedback" ? "feedback" : "preview";

  const load = useCallback(
    () =>
      api
        .get<ProjectDetail>(`/api/panel/projects/${id}`)
        .then(setP)
        .catch((e) => setError(errorMessage(e))),
    [id],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (p) onWorkspace(p.workspaceId);
  }, [p, onWorkspace]);

  if (error) return <ErrorText>{t(error)}</ErrorText>;
  if (!p) return <Loading />;
  const state = roundState(p);
  const setTab = (next: Tab) => navigate(`/p/${id}${next === "feedback" ? "?tab=feedback" : ""}`, true);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to={`/w/${p.workspaceId}`} className="text-[13px] text-muted hover:text-ink">
          ← {p.client?.name ?? t("Projects")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold">{p.name}</h1>
          <Badge tone={state.tone}>{t(state.label)}</Badge>
        </div>
        <p className="text-[13px] text-muted">
          {p.latestVersion ? t("Version {n}, published {ago}", { n: p.latestVersion.number, ago: timeAgo(p.latestVersion.publishedAt, t) }) : t("Not published yet")}
          {p.createdBy && ` · ${t("created by {name}", { name: p.createdBy })}`}
        </p>
      </div>

      <LinkCard project={p} onChange={setP} />

      <div className="flex gap-1 border-b border-line">
        {(["preview", "feedback"] as const).map((k) => (
          <button
            key={k}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] font-medium ${tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            onClick={() => setTab(k)}
          >
            {k === "preview" ? t("Versions") : t("Client feedback")}
            {k === "feedback" && p.round?.status === "submitted" && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" />}
          </button>
        ))}
      </div>

      {tab === "preview" ? <Versions project={p} /> : <Rounds project={p} />}
    </div>
  );
}

function LinkCard({ project: p, onChange }: { project: ProjectDetail; onChange: (p: ProjectDetail) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"regenerate" | "delete" | undefined>();
  const [typed, setTyped] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChange(await api.get<ProjectDetail>(`/api/panel/projects/${p.id}`));
      setConfirm(undefined);
    } catch (e) {
      setError(t(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (status: "open" | "readonly" | "revoked") => act(() => api.patch(`/api/panel/projects/${p.id}/share`, { status }));

  return (
    <section className="card p-4">
      {p.url ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`min-w-0 flex-1 truncate rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[13px] ${p.shareStatus === "revoked" ? "text-faint line-through" : ""}`}>{p.url}</div>
            <CopyButton text={p.url} label={t("Copy link")} />
            <a className={`btn ${p.shareStatus === "revoked" ? "pointer-events-none opacity-50" : ""}`} href={p.url} target="_blank" rel="noreferrer">
              {t("Open")}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">
              {p.shareStatus === "open" && t("The client can view, edit and comment.")}
              {p.shareStatus === "readonly" && t("Read-only: the client can view but not change anything.")}
              {p.shareStatus === "revoked" && t("Disabled: the link shows “not available”.")}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {p.shareStatus !== "open" && (
                <button className="btn" disabled={busy} onClick={() => void setStatus("open")}>
                  {t("Re-enable editing")}
                </button>
              )}
              {p.shareStatus === "open" && (
                <button className="btn" disabled={busy} onClick={() => void setStatus("readonly")}>
                  {t("Make read-only")}
                </button>
              )}
              {p.shareStatus !== "revoked" && (
                <button className="btn" disabled={busy} onClick={() => void setStatus("revoked")}>
                  {t("Disable link")}
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => setConfirm("regenerate")}>
                {t("New link")}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm("delete")}>
                {t("Delete")}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-muted">{t("No link yet: publish a version from Claude Code.")}</p>
          <button className="btn btn-danger" onClick={() => setConfirm("delete")}>
            {t("Delete")}
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {confirm === "regenerate" && (
        <Modal
          title={t("Create a new link?")}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(undefined)}>{t("Cancel")}</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.post(`/api/panel/projects/${p.id}/share/regenerate`))}>
                {t("Create new link")}
              </button>
            </>
          }
        >
          <p>{t("The current link stops working immediately. Edits and notes are kept. Send the new link to the client.")}</p>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal
          title={t("Delete “{name}”?", { name: p.name })}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(undefined)}>{t("Cancel")}</button>
              <button
                className="btn border-danger bg-danger text-white hover:bg-danger/90"
                disabled={busy || typed.trim() !== p.name}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await api.del(`/api/panel/projects/${p.id}`);
                      navigate(`/w/${p.workspaceId}`, true);
                    } catch (e) {
                      setError(t(errorMessage(e)));
                      setBusy(false);
                    }
                  })()
                }
              >
                {t("Delete forever")}
              </button>
            </>
          }
        >
          <p>{t("All versions, the client's edits, images and notes are deleted, and the link stops working. This can't be undone.")}</p>
          <label className="label mt-4" htmlFor="confirm-name">{t("Type the project name to confirm")}</label>
          <input id="confirm-name" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Modal>
      )}
    </section>
  );
}

const WIDTHS = { desktop: 1280, tablet: 820, mobile: 390 } as const;

function Versions({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const [selected, setSelected] = useState(p.versions[0]?.number);
  const [device, setDevice] = useState<keyof typeof WIDTHS>("desktop");
  const v = p.versions.find((x) => x.number === selected);

  if (!p.versions.length) return <p className="py-10 text-center text-muted">{t("No versions yet.")}</p>;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ol className="flex flex-col gap-2">
        {p.versions.map((x) => (
          <li key={x.id}>
            <button
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${x.number === selected ? "border-accent bg-accent-soft/60" : "border-line bg-panel hover:bg-canvas"}`}
              onClick={() => setSelected(x.number)}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">v{x.number}</span>
                <span className="ml-auto text-[12px] text-faint">{timeAgo(x.publishedAt, t)}</span>
              </div>
              {x.changelog && <p className="mt-1 line-clamp-3 text-[12.5px] whitespace-pre-line text-muted">{x.changelog}</p>}
            </button>
          </li>
        ))}
      </ol>
      {v && (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">
              {t("Published {date}", { date: formatDate(v.publishedAt) })}
              {v.publishedBy && ` · ${v.publishedBy}`}
            </span>
            <div className="ml-auto flex rounded-md border border-line bg-panel p-0.5">
              {(Object.keys(WIDTHS) as (keyof typeof WIDTHS)[]).map((d) => (
                <button key={d} className={`rounded px-2.5 py-1 text-[12.5px] ${device === d ? "bg-accent-soft font-medium text-accent" : "text-muted"}`} onClick={() => setDevice(d)}>
                  {t(d === "desktop" ? "Desktop" : d === "tablet" ? "Tablet" : "Mobile")}
                </button>
              ))}
            </div>
            {v.previewUrl && (
              <a className="btn" href={v.previewUrl} target="_blank" rel="noreferrer">
                {t("Open")}
              </a>
            )}
          </div>
          {v.previewUrl ? <ScaledFrame key={`${v.id}-${device}`} src={v.previewUrl} width={WIDTHS[device]} /> : <p className="text-muted">{t("No preview domain.")}</p>}
          {v.changelog && (
            <div className="card p-4">
              <h3 className="mb-1 text-[13px] font-semibold">{t("What changed")}</h3>
              <p className="text-[13.5px] whitespace-pre-line text-muted">{v.changelog}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** An iframe rendered at a device width and scaled down to fit its container. */
function ScaledFrame({ src, width }: { src: string; width: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const height = 760;
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-line bg-white" style={{ height: height * scale }}>
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner />
        </div>
      )}
      <iframe
        title="Preview"
        src={src}
        onLoad={() => setLoaded(true)}
        className="absolute top-0 left-1/2 origin-top border-0"
        style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}

function Rounds({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const [selected, setSelected] = useState(p.rounds.find((r) => r.status === "submitted")?.id ?? p.rounds[0]?.id);
  const [fb, setFb] = useState<Feedback | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selected) return;
    setFb(undefined);
    api
      .get<Feedback>(`/api/panel/rounds/${selected}`)
      .then(setFb)
      .catch((e) => setError(errorMessage(e)));
  }, [selected]);

  if (!p.rounds.length) return <p className="py-10 text-center text-muted">{t("No review rounds yet.")}</p>;
  const round = p.rounds.find((r) => r.id === selected);
  const versionBase = (n: number | null) => p.versions.find((v) => v.number === n)?.previewUrl ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {p.rounds.map((r) => (
          <button
            key={r.id}
            className={`rounded-full border px-3 py-1 text-[13px] ${r.id === selected ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-panel text-muted hover:text-ink"}`}
            onClick={() => setSelected(r.id)}
          >
            {t("Review of v{n}", { n: r.versionNumber ?? "?" })}
            {r.status === "submitted" && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warn" />}
          </button>
        ))}
      </div>

      {round && (
        <p className="text-[13px] text-muted">
          {round.status === "open" && t("Open since {date}. The client hasn't pressed “I'm done” yet.", { date: formatDate(round.openedAt) })}
          {round.status === "submitted" &&
            t("{who} sent the feedback on {date}. Ask Claude to check the feedback to apply it.", { who: round.submittedBy ?? t("The client"), date: formatDate(round.submittedAt!) })}
          {round.status === "imported" && t("Imported on {date}.", { date: formatDate(round.importedAt!) })}
        </p>
      )}

      <ErrorText>{error}</ErrorText>
      {!fb ? (
        !error && <Loading />
      ) : fb.edits.length + fb.comments.length === 0 ? (
        <p className="py-8 text-center text-muted">{t("No edits or notes in this round.")}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{t("Notes ({n})", { n: fb.comments.length })}</h3>
            <div className="flex flex-col gap-2">
              {fb.comments.map((c, i) => (
                <div key={c.id} className="card p-3.5">
                  <div className="flex items-center gap-2 text-[12.5px] text-muted">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">{i + 1}</span>
                    <span className="font-medium text-ink">{c.author}</span>
                    <span>· {c.page}</span>
                    {c.anchor.key && <code className="truncate rounded bg-canvas px-1 text-[11.5px]">{c.anchor.key}</code>}
                    {c.status !== "open" && <Badge tone={c.status === "resolved" ? "ok" : "accent"}>{t(c.status === "resolved" ? "Resolved" : "Answered")}</Badge>}
                  </div>
                  <p className="mt-1.5 whitespace-pre-line">{c.text}</p>
                  {c.reply && <p className="mt-2 border-l-2 border-accent/40 pl-2.5 text-[13px] text-muted">{c.reply}</p>}
                </div>
              ))}
              {fb.comments.length === 0 && <p className="text-muted">{t("No notes.")}</p>}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{t("Edits ({n})", { n: fb.edits.length })}</h3>
            <div className="flex flex-col gap-2">
              {fb.edits.map((e) => (
                <div key={e.key} className="card p-3.5">
                  <div className="flex items-center gap-2 text-[12.5px] text-muted">
                    <code className="truncate rounded bg-canvas px-1 text-[11.5px]">{e.key}</code>
                    <span className="ml-auto shrink-0">{e.author}</span>
                  </div>
                  <EditValue before={e.before} after={e.value} uploads={fb.uploads} base={versionBase(fb.round.versionNumber)} />
                </div>
              ))}
              {fb.edits.length === 0 && <p className="text-muted">{t("No edits.")}</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function EditValue({ before, after, uploads, base }: { before: ContentValue | null; after: ContentValue; uploads: Feedback["uploads"]; base: string | null }) {
  const t = useT();
  const imgSrc = (src: string) => {
    const id = /__pt\/uploads\/([0-9a-f-]{36})$/.exec(src)?.[1];
    if (id) return uploads.find((u) => u.id === id)?.url ?? null;
    if (/^https?:\/\//.test(src)) return src;
    return base ? new URL(src, base).toString() : null;
  };
  const text = (v: ContentValue | null) =>
    !v ? "" : v.kind === "text" ? v.text : v.kind === "link" ? `${v.text} → ${v.href}` : v.kind === "rich" ? v.html.replace(/<[^>]+>/g, "") : "";

  if (after.kind === "image" || after.kind === "bg") {
    const old = before && (before.kind === "image" || before.kind === "bg") ? imgSrc(before.src) : null;
    const now = imgSrc(after.src);
    return (
      <div className="mt-2 flex items-center gap-2">
        {old ? <img src={old} alt="" className="h-20 w-28 rounded border border-line object-cover" /> : <span className="h-20 w-28 rounded border border-dashed border-line" />}
        <span className="text-faint">→</span>
        {now ? <img src={now} alt={after.kind === "image" ? (after.alt ?? "") : ""} className="h-20 w-28 rounded border border-line object-cover" /> : <span className="text-muted">{t("New image")}</span>}
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-[13.5px]">
      <p className="text-faint line-through">{text(before)}</p>
      <p>{text(after)}</p>
    </div>
  );
}
