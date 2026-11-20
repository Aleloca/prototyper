import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type ContentValue, type Feedback, type ProjectDetail } from "../api";
import { ArrowLeft, ArrowRight, Download, ExternalLink, Eye, Laptop, Link2, Link2Off, Maximize2, RefreshCw, Smartphone, Tablet, Trash2, X } from "../components/icons";
import { Modal } from "../components/Modal";
import { CopyButton, ErrorText, Mark, StateLabel, Spinner, Tag, roundState, swatchCode, type MarkKind } from "../components/ui";
import { errorMessage, formatDate, timeAgo } from "../format";
import { useT } from "../i18n";
import { Link, navigate, useLocation } from "../router";
import { spotFor, type Spot } from "../swatch";

type Tab = "versions" | "feedback";

export function ProjectScreen({ id, onWorkspace }: { id: string; onWorkspace: (workspaceId: string) => void }) {
  const t = useT();
  const { search } = useLocation();
  const [p, setP] = useState<ProjectDetail | undefined>();
  const [error, setError] = useState("");
  const tab: Tab = search.get("tab") === "feedback" ? "feedback" : "versions";

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
  if (!p) return <ProjectSkeleton />;
  const spot = spotFor(p.client?.swatch);
  const state = roundState(p);
  const setTab = (next: Tab) => navigate(`/p/${id}${next === "feedback" ? "?tab=feedback" : ""}`, true);
  const pending = p.round?.status === "submitted";

  return (
    <div className="flex flex-col gap-7">
      <div>
        <Link to={`/w/${p.workspaceId}`} className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-muted hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          {t("All projects")}
        </Link>
        <div className="mt-4 flex flex-wrap items-stretch gap-5">
          <div className="flex w-[104px] shrink-0 flex-col justify-between rounded-[3px] p-3 shadow-[var(--shadow-chip)]" style={{ background: spot.bg, color: spot.fg }} aria-hidden>
            <span className="caps num" style={{ color: spot.fg2 }}>
              {swatchCode(p.client?.name, p.number)}
            </span>
            <span className="text-[28px] leading-none font-bold tracking-[-0.03em]">{p.latestVersion ? `v${p.latestVersion.number}` : "—"}</span>
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <p className="text-[14px] font-medium text-muted">{p.client?.name}</p>
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">{p.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted">
              <StateLabel kind={state.mark}>{t(state.label)}</StateLabel>
              <span>
                {[
                  p.latestVersion ? t("Version {n}, published {ago}", { n: p.latestVersion.number, ago: timeAgo(p.latestVersion.publishedAt, t) }) : t("Not published yet"),
                  p.createdBy ? t("created by {name}", { name: p.createdBy }) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <LinkCard project={p} onChange={setP} />

      <div>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "versions"} onClick={() => setTab("versions")}>
            {t("Versions")} <span className="num ml-1 text-faint">{p.versions.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "feedback"} onClick={() => setTab("feedback")} className="inline-flex items-center gap-2">
            {t("Client feedback")}
            {pending && <Mark kind="attention" />}
          </button>
        </div>
        <div className="pt-6" role="tabpanel">
          {tab === "versions" ? <Versions project={p} spot={spot} /> : <Rounds project={p} />}
        </div>
      </div>
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
  const access: { kind: MarkKind; text: string } =
    p.shareStatus === "revoked"
      ? { kind: "off", text: t("Disabled: the link shows “not available”.") }
      : p.shareStatus === "readonly"
        ? { kind: "waiting", text: t("Read-only: the client can view but not change anything.") }
        : { kind: "done", text: t("The client can view, edit and comment.") };

  return (
    <section className="sheet p-5" aria-label={t("Client link")}>
      {p.url ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 basis-80 items-center gap-2.5 rounded-[4px] bg-wash px-3 py-2.5">
              <Link2 aria-hidden className="size-4 shrink-0 text-muted" />
              <span className={`min-w-0 truncate text-[13.5px] ${p.shareStatus === "revoked" ? "text-faint line-through" : "text-ink-2"}`}>{p.url}</span>
            </div>
            <CopyButton text={p.url} label={t("Copy link")} className="btn-primary" />
            <a className={`btn ${p.shareStatus === "revoked" ? "pointer-events-none opacity-45" : ""}`} href={p.url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              {t("Open as the client")}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-[13.5px]">
            <span className="inline-flex items-center gap-2 text-ink-2">
              <Mark kind={access.kind} />
              {access.text}
            </span>
            <span className="ml-auto flex flex-wrap gap-1">
              {p.shareStatus !== "open" && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setStatus("open")}>
                  {t("Re-enable editing")}
                </button>
              )}
              {p.shareStatus === "open" && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setStatus("readonly")}>
                  <Eye aria-hidden />
                  {t("Make read-only")}
                </button>
              )}
              {p.shareStatus !== "revoked" && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setStatus("revoked")}>
                  <Link2Off aria-hidden />
                  {t("Disable link")}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm("regenerate")}>
                <RefreshCw aria-hidden />
                {t("New link")}
              </button>
              <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-wash" disabled={busy} onClick={() => setConfirm("delete")}>
                <Trash2 aria-hidden />
                {t("Delete")}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-muted">{t("No link yet: publish a version from Claude Code.")}</p>
          <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-wash" onClick={() => setConfirm("delete")}>
            <Trash2 aria-hidden />
            {t("Delete")}
          </button>
        </div>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>

      {confirm === "regenerate" && (
        <Modal
          title={t("Create a new link?")}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(undefined)}>
                {t("Cancel")}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.post(`/api/panel/projects/${p.id}/share/regenerate`))}>
                {t("Create new link")}
              </button>
            </>
          }
        >
          <p className="text-ink-2">{t("The current link stops working immediately. Edits and notes are kept. Send the new link to the client.")}</p>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal
          title={t("Delete “{name}”?", { name: p.name })}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(undefined)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
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
          <p className="text-ink-2">{t("All versions, the client's edits, images and notes are deleted, and the link stops working. This can't be undone.")}</p>
          <label className="label mt-5" htmlFor="confirm-name">
            {t("Type the project name to confirm")}
          </label>
          <input id="confirm-name" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
        </Modal>
      )}
    </section>
  );
}

const DEVICES = {
  desktop: { width: 1280, icon: Laptop, label: "Desktop" },
  tablet: { width: 820, icon: Tablet, label: "Tablet" },
  mobile: { width: 390, icon: Smartphone, label: "Mobile" },
} as const;
type Device = keyof typeof DEVICES;

function DeviceSwitch({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  const t = useT();
  return (
    <div className="seg" role="group" aria-label={t("Preview width")}>
      {(Object.keys(DEVICES) as Device[]).map((d) => {
        const Icon = DEVICES[d].icon;
        return (
          <button key={d} type="button" aria-pressed={device === d} onClick={() => onChange(d)} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden className="size-4" />
            <span className="hidden sm:inline">{t(DEVICES[d].label)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Versions as a fan deck: chips riveted at the bottom-left, fanned out like a swatch book. The
 * chosen version swings out of the deck; order reads by position, every chip at full colour.
 */
function VersionFan({ project: p, spot, selected, onSelect }: { project: ProjectDetail; spot: Spot; selected: number | undefined; onSelect: (n: number) => void }) {
  const t = useT();
  const versions = p.versions.slice().reverse(); // oldest first, at the back
  const n = versions.length;
  const W = 52;
  const H = 96;
  // Wide enough that each chip's label edge stays visible behind the next one.
  const step = n > 1 ? Math.min(16, 84 / (n - 1)) : 0;
  const span = (n - 1) * step;
  const rad = (d: number) => (d * Math.PI) / 180;
  const width = Math.ceil(W * Math.cos(rad(span)) + H * Math.sin(rad(span))) + 30;
  const pivot = { x: 12, y: H - 12 };
  return (
    <div className="relative shrink-0" style={{ width, height: H + 16 }} role="listbox" aria-label={t("Versions")} aria-orientation="horizontal">
      {versions.map((v, i) => {
        const on = v.number === selected;
        return (
          <button
            key={v.id}
            type="button"
            role="option"
            aria-selected={on}
            aria-label={t("Version {n}", { n: v.number })}
            title={t("Published {date}", { date: formatDate(v.publishedAt) })}
            onClick={() => onSelect(v.number)}
            className={`absolute bottom-0 left-0 flex overflow-hidden rounded-[3px] text-left transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${on ? "shadow-[var(--shadow-lift)]" : "shadow-[var(--shadow-chip)]"}`}
            style={{
              width: W,
              height: H,
              zIndex: i + 1,
              background: spot.bg,
              transformOrigin: `${pivot.x}px ${pivot.y}px`,
              transform: `rotate(${i * step}deg) translateY(${on ? -16 : 0}px)`,
            }}
          >
            {/* The printed label runs up the chip's left edge, the part the next chip leaves visible. */}
            <span
              className={`num flex h-[58px] w-[17px] items-center justify-center bg-stock text-[11.5px] font-bold [writing-mode:vertical-rl] rotate-180 ${on ? "text-ink" : "text-muted"}`}
            >
              v{v.number}
            </span>
          </button>
        );
      })}
      {/* The rivet that holds the deck */}
      <span aria-hidden className="pointer-events-none absolute z-50 grid size-[11px] place-items-center rounded-full bg-ink shadow-[0_0_0_2px_#fff]" style={{ left: pivot.x - 5.5, bottom: H - pivot.y - 5.5 }}>
        <span className="size-[3px] rounded-full bg-white/70" />
      </span>
    </div>
  );
}

function Versions({ project: p, spot }: { project: ProjectDetail; spot: Spot }) {
  const t = useT();
  const [selected, setSelected] = useState(p.versions[0]?.number);
  const [device, setDevice] = useState<Device>("desktop");
  const [meeting, setMeeting] = useState(false);
  const v = p.versions.find((x) => x.number === selected);

  if (!p.versions.length) return <p className="py-10 text-center text-muted">{t("No versions yet.")}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      {/* The deck and the version's facts sit beside the preview, so the preview starts at the top. */}
      <aside className="flex flex-col gap-5 text-[13.5px] lg:order-2">
        <VersionFan project={p} spot={spot} selected={selected} onSelect={setSelected} />
        {v && (
          <>
            <div>
              <h3 className="caps text-faint">{t("Version {n}", { n: v.number })}</h3>
              <p className="mt-1 text-ink-2">
                {t("Published {date}", { date: formatDate(v.publishedAt) })}
                {v.publishedBy && <> · {v.publishedBy}</>}
              </p>
            </div>
            <div>
              <h3 className="caps text-faint">{t("What changed")}</h3>
              <p className="mt-1 whitespace-pre-line text-ink-2">{v.changelog || t("First version.")}</p>
            </div>
            {v.previewUrl && (
              <a className="inline-flex items-center gap-1.5 self-start font-medium text-ink underline underline-offset-3" href={v.previewUrl} target="_blank" rel="noreferrer">
                {t("Open this version")}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            )}
            {v.source && (
              <a className="inline-flex items-center gap-1.5 self-start font-medium text-ink underline underline-offset-3" href={v.source} download>
                {t("Download the code")}
                <Download aria-hidden className="size-3.5" />
              </a>
            )}
          </>
        )}
      </aside>
      {v && (
        <div className="flex min-w-0 flex-col gap-3 lg:order-1">
          <div className="flex flex-wrap items-center gap-2">
            <DeviceSwitch device={device} onChange={setDevice} />
            {v.previewUrl && (
              <button type="button" className="btn ml-auto" onClick={() => setMeeting(true)}>
                <Maximize2 aria-hidden />
                {t("Meeting mode")}
              </button>
            )}
          </div>
          {v.previewUrl ? <ScaledFrame key={`${v.id}-${device}`} src={v.previewUrl} width={DEVICES[device].width} /> : <p className="text-muted">{t("No preview domain.")}</p>}
        </div>
      )}
      {meeting && <MeetingMode project={p} spot={spot} selected={selected} onSelect={setSelected} device={device} onDevice={setDevice} onClose={() => setMeeting(false)} />}
    </div>
  );
}

/** One version owns the screen, for walking a client through it. */
function MeetingMode(props: { project: ProjectDetail; spot: Spot; selected: number | undefined; onSelect: (n: number) => void; device: Device; onDevice: (d: Device) => void; onClose: () => void }) {
  const t = useT();
  const { onClose } = props;
  const v = props.project.versions.find((x) => x.number === props.selected);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener("cancel", onCancel);
    return () => d?.removeEventListener("cancel", onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} aria-label={t("Meeting mode")} className="m-0 h-dvh max-h-none w-dvw max-w-none bg-paper p-0 text-ink">
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-line bg-stock px-6 pt-2 pb-3">
          <div className="pb-1">
            <p className="text-[13px] text-muted">{props.project.client?.name}</p>
            <p className="text-[16px] font-bold tracking-[-0.01em]">{props.project.name}</p>
          </div>
          <VersionFan project={props.project} spot={props.spot} selected={props.selected} onSelect={props.onSelect} />
          <div className="ml-auto flex items-center gap-2 pb-1">
            <DeviceSwitch device={props.device} onChange={props.onDevice} />
            <button type="button" className="btn" onClick={onClose}>
              <X aria-hidden />
              {t("Exit")}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {v?.previewUrl && <ScaledFrame key={`${v.id}-${props.device}-meeting`} src={v.previewUrl} width={DEVICES[props.device].width} fill />}
        </div>
      </div>
    </dialog>
  );
}

/** An iframe rendered at a device width and scaled down to fit its container. */
function ScaledFrame({ src, width, fill = false }: { src: string; width: number; fill?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 780 });
  const [loaded, setLoaded] = useState(false);
  const [frameWidth, setFrameWidth] = useState(width);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // In meeting mode a desktop preview takes the whole width available.
      const w = fill && width >= 1280 ? Math.max(width, el.clientWidth) : width;
      setFrameWidth(w);
      const scale = Math.min(1, el.clientWidth / w);
      const height = fill ? (el.parentElement?.clientHeight ?? 780) / scale : 780;
      setSize({ scale, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, fill]);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-[4px] bg-stock shadow-[var(--shadow-chip)]" style={{ height: size.height * size.scale }}>
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner />
        </div>
      )}
      <iframe
        title={t("Preview")}
        src={src}
        onLoad={() => setLoaded(true)}
        className="absolute top-0 left-1/2 origin-top border-0"
        style={{ width: frameWidth, height: size.height, transform: `translateX(-50%) scale(${size.scale})` }}
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
  // A round still open under a newer version was never reviewed.
  const latest = p.rounds[0]?.id;
  const roundMark = (r: { id: number; status: string }): MarkKind =>
    r.status === "submitted" ? "attention" : r.status === "imported" ? "done" : r.id === latest ? "waiting" : "none";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Review rounds")}>
        {p.rounds.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={r.id === selected}
            onClick={() => setSelected(r.id)}
            className={`inline-flex h-9 items-center gap-2 rounded-[4px] border px-3 text-[13.5px] font-medium transition-colors duration-150 ${r.id === selected ? "border-ink bg-ink text-white" : "border-line-strong bg-stock text-ink-2 hover:border-ink/40"}`}
          >
            <Mark kind={roundMark(r)} className={r.id === selected ? "!text-white" : ""} />
            {t("Review of v{n}", { n: r.versionNumber ?? "?" })}
          </button>
        ))}
      </div>

      {round && (
        <p className="max-w-[80ch] text-[14px] text-ink-2">
          {round.status === "open" && round.id === latest && t("Open since {date}. The client hasn't pressed “I'm done” yet.", { date: formatDate(round.openedAt) })}
          {round.status === "open" && round.id !== latest && t("Not reviewed: a newer version was published first.")}
          {round.status === "submitted" && t("{who} sent the feedback on {date}. Ask Claude to check the feedback to apply it.", { who: round.submittedBy ?? t("The client"), date: formatDate(round.submittedAt!) })}
          {round.status === "imported" && t("Imported on {date}.", { date: formatDate(round.importedAt!) })}
        </p>
      )}

      <ErrorText>{error}</ErrorText>
      {!fb ? (
        !error && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="skeleton h-40" />
            <div className="skeleton h-40" />
          </div>
        )
      ) : fb.edits.length + fb.comments.length === 0 ? (
        <p className="rounded-[4px] border border-dashed border-line-strong py-10 text-center text-muted">{t("No edits or notes in this round.")}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="notes-h">
            <h3 id="notes-h" className="caps mb-3 text-faint">
              {t("Notes ({n})", { n: fb.comments.length })}
            </h3>
            <ol className="flex flex-col gap-3">
              {fb.comments.map((c, i) => (
                <li key={c.id} className="sheet p-4">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
                    <span className="num grid size-6 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">{i + 1}</span>
                    <span className="font-semibold text-ink">{c.author}</span>
                    <span>{c.page}</span>
                    {c.status !== "open" && <Tag tone={c.status === "resolved" ? "done" : "reviewing"}>{t(c.status === "resolved" ? "Resolved" : "Answered")}</Tag>}
                  </div>
                  <p className="mt-2 text-[14.5px] whitespace-pre-line">{c.text}</p>
                  {c.reply && (
                    <div className="mt-3 rounded-[4px] bg-wash px-3 py-2 text-[13.5px] text-ink-2">
                      <span className="caps mr-2 text-faint">{t("Reply")}</span>
                      {c.reply}
                    </div>
                  )}
                </li>
              ))}
              {fb.comments.length === 0 && <li className="text-muted">{t("No notes.")}</li>}
            </ol>
          </section>
          <section aria-labelledby="edits-h">
            <h3 id="edits-h" className="caps mb-3 text-faint">
              {t("Edits ({n})", { n: fb.edits.length })}
            </h3>
            <ul className="flex flex-col gap-3">
              {fb.edits.map((e) => (
                <li key={e.key} className="sheet p-4">
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    <span className="truncate">{e.page}</span>
                    <span className="ml-auto shrink-0 font-semibold text-ink">{e.author}</span>
                  </div>
                  <EditValue before={e.before} after={e.value} uploads={fb.uploads} base={versionBase(fb.round.versionNumber)} />
                  <p className="mt-2 truncate font-mono text-[11.5px] text-faint" title={t("Content key")}>
                    {e.key}
                  </p>
                </li>
              ))}
              {fb.edits.length === 0 && <li className="text-muted">{t("No edits.")}</li>}
            </ul>
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
    const box = "h-24 w-36 rounded-[3px] bg-wash object-cover shadow-[var(--shadow-chip)]";
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {old ? <img src={old} alt={t("Before")} className={`${box} opacity-70`} /> : <span className={box} />}
        <ArrowRight aria-hidden className="size-4 text-faint" />
        {now ? <img src={now} alt={after.kind === "image" ? (after.alt ?? t("New image")) : t("New image")} className={box} /> : <span className="text-muted">{t("New image")}</span>}
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[13.5px] text-faint line-through decoration-faint/60">{text(before)}</p>
      <p className="text-[16px] font-medium">{text(after)}</p>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="skeleton h-4 w-28" />
      <div className="flex gap-5">
        <div className="skeleton h-[104px] w-[104px]" />
        <div className="flex flex-1 flex-col gap-2 pt-2">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-8 w-80" />
          <div className="skeleton h-4 w-64" />
        </div>
      </div>
      <div className="skeleton h-28" />
      <div className="skeleton h-96" />
    </div>
  );
}
