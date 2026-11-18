import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoDetail, DemoRef, GenerateOptions, RunEvent } from "@common/types";
import { ReferencesPanel } from "../components/ReferencesPanel";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage, timeAgo } from "../format";
import { ExportDialog } from "./ExportDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { ShareDialog } from "./ShareDialog";
import { useT } from "../i18n";

type Device = "desktop" | "tablet" | "mobile";
const DEVICE_WIDTH: Record<Device, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };
type Tab = "claude" | "references" | "versions" | "checks";

const sameRef = (a: DemoRef, b: DemoRef) => a.client === b.client && a.demo === b.demo;

export function Workspace(props: { demoRef: DemoRef; autostart?: GenerateOptions; onBack: () => void }) {
  const t = useT();
  const { demoRef } = props;
  const [detail, setDetail] = useState<DemoDetail | undefined>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [phase, setPhase] = useState<string | undefined>();
  const [device, setDevice] = useState<Device>("desktop");
  const [tab, setTab] = useState<Tab>("claude");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const started = useRef(false);

  const reload = useCallback(() => void api.demo.detail(demoRef).then(setDetail), [demoRef]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await api.demo.open(demoRef);
      const [d, log] = await Promise.all([api.demo.detail(demoRef), api.demo.log(demoRef)]);
      if (!alive) return;
      setDetail(d);
      setEvents(log);
      if (props.autostart && !started.current && !d.hasPages && !d.running && log.length === 0) {
        started.current = true;
        await run(() => api.demo.generate(demoRef, props.autostart!));
      }
    })();
    const offEvent = api.onDemoEvent(({ ref, event }) => {
      if (!sameRef(ref, demoRef)) return;
      if (event.type === "phase") return setPhase(event.message);
      if (event.type === "done") setPhase(undefined);
      setEvents((prev) => [...prev, event]);
    });
    const offChanged = api.onDemoChanged((ref) => sameRef(ref, demoRef) && reload());
    return () => {
      alive = false;
      offEvent();
      offChanged();
      void api.demo.close(demoRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRef]);

  const run = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      setPhase(t("Starting Claude…"));
      await fn();
      reload();
    } catch (e) {
      setPhase(undefined);
      setError(errorMessage(e));
    }
  };

  if (!detail) return null;
  const { meta } = detail;
  const version = meta.versions.at(-1);
  const running = detail.running || phase !== undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-line bg-panel pr-3 pl-24">
        <button className="no-drag btn btn-ghost -ml-2 px-2" onClick={props.onBack} aria-label="Back to library">
          {t("← Library")}
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-muted">{detail.clientName}</span>
          <span className="text-faint">/</span>
          <span className="truncate font-semibold">{meta.name}</span>
          {version && <span className="text-faint">v{version.number}</span>}
          {detail.unsavedChanges && version && <span className="text-[12px] text-warn">· {t("unsaved changes")}</span>}
        </div>

        <div className="no-drag mx-auto flex rounded-md border border-line p-0.5" role="group" aria-label="Preview size">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              aria-pressed={device === d}
              className={`rounded px-2.5 py-1 text-[12px] ${device === d ? "bg-ink text-white" : "text-muted hover:bg-black/5"}`}
            >
              {t(d[0]!.toUpperCase() + d.slice(1))}
            </button>
          ))}
        </div>

        <div className="no-drag flex items-center gap-1.5">
          <button className="btn btn-ghost" onClick={() => void api.demo.openInBrowser(demoRef)} disabled={!detail.hasPages}>
            {t("Browser")}
          </button>
          <button className="btn btn-ghost" onClick={() => void api.demo.openFolder(demoRef)}>
            {t("Folder")}
          </button>
          <button className="btn btn-ghost" onClick={() => void api.demo.openTerminal(demoRef)} title={t("Continue this demo's Claude session in Terminal")}>
            {t("Terminal")}
          </button>
          <button className="btn btn-ghost" disabled={!detail.hasPages || running} onClick={() => setExporting(true)}>
            {t("Export")}
          </button>
          <button className="btn" disabled={!detail.unsavedChanges || running} onClick={() => setSaving(true)}>
            {t("Save version")}
          </button>
          <button className="btn btn-primary" disabled={!version || running} onClick={() => setSharing(true)}>
            {t(meta.share ? "Shared" : "Share")}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 justify-center overflow-auto bg-[#e9e9e5] p-3">
          {detail.hasPages ? (
            <iframe
              title="Preview"
              src={detail.previewUrl}
              style={{ width: DEVICE_WIDTH[device] }}
              className={`h-full max-w-full bg-white shadow-sm transition-[width] duration-200 ${device === "desktop" ? "" : "rounded-lg border border-line"}`}
            />
          ) : (
            <EmptyPreview
              running={running}
              pendingStructure={!!meta.pendingStructure}
              onGenerate={() => void run(() => api.demo.generate(demoRef, { structureFirst: false }))}
            />
          )}
        </div>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-panel">
          <nav className="flex gap-1 border-b border-line px-3 pt-2" role="tablist">
            <TabButton active={tab === "claude"} onClick={() => setTab("claude")}>{t("Claude")}</TabButton>
            <TabButton active={tab === "references"} onClick={() => setTab("references")}>{t("References")}</TabButton>
            <TabButton active={tab === "versions"} onClick={() => setTab("versions")}>
              {t("Versions")} {meta.versions.length > 0 && <span className="text-faint">{meta.versions.length}</span>}
            </TabButton>
            <TabButton active={tab === "checks"} onClick={() => setTab("checks")}>
              {t("Checks")} {detail.lint && detail.lint.errors > 0 && <span className="text-danger">{detail.lint.errors}</span>}
            </TabButton>
          </nav>
          {meta.lastRound && meta.lastRound.status !== "imported" && (meta.lastRound.edits > 0 || meta.lastRound.comments > 0) && (
            <div className={`mx-3 mt-3 rounded-lg border px-3 py-2.5 ${meta.lastRound.status === "submitted" ? "border-warn/40 bg-warn/10" : "border-line bg-canvas"}`}>
              <p className="font-medium">
                {meta.lastRound.status === "submitted" ? t("{name} sent feedback on v{n}", { name: meta.lastRound.submittedBy ?? t("The client"), n: meta.lastRound.versionNumber ?? "" }) : t("The client is reviewing v{n}", { n: meta.lastRound.versionNumber ?? "" })}
              </p>
              <p className="text-muted">
                {t(meta.lastRound.edits === 1 ? "{n} edit" : "{n} edits", { n: meta.lastRound.edits })} · {t(meta.lastRound.comments === 1 ? "{n} note" : "{n} notes", { n: meta.lastRound.comments })}
              </p>
              <button className="btn btn-primary mt-2" disabled={running} onClick={() => setReviewing(true)}>
                {t("Review feedback")}
              </button>
            </div>
          )}
          {tab === "claude" && (
            <ClaudePanel
              events={events}
              phase={phase}
              running={running}
              error={error}
              pendingStructure={meta.pendingStructure}
              onSend={(text) => run(() => api.demo.chat(demoRef, text))}
              onApprove={(feedback) => run(() => api.demo.approveStructure(demoRef, feedback))}
              onCancel={() => void api.demo.cancel(demoRef)}
            />
          )}
          {tab === "references" && <ReferencesPanel demoRef={demoRef} />}
          {tab === "versions" && <VersionsPanel detail={detail} />}
          {tab === "checks" && <ChecksPanel detail={detail} />}
        </aside>
      </div>

      {exporting && (
        <ExportDialog
          demoRef={demoRef}
          detail={detail}
          onClose={() => setExporting(false)}
          onStarted={() => {
            setExporting(false);
            setTab("claude");
            setPhase(t("Exporting…"));
          }}
        />
      )}
      {reviewing && (
        <FeedbackDialog
          demoRef={demoRef}
          nextVersion={(version?.number ?? 0) + 1}
          onClose={() => setReviewing(false)}
          onStarted={() => {
            setReviewing(false);
            setTab("claude");
            setPhase(t("Applying client feedback…"));
          }}
        />
      )}
      {sharing && (
        <ShareDialog
          demoRef={demoRef}
          detail={detail}
          onClose={() => setSharing(false)}
          onReview={() => {
            setSharing(false);
            setReviewing(true);
          }}
          onSaveVersion={() => {
            setSharing(false);
            setSaving(true);
          }}
        />
      )}
      {saving && (
        <SaveVersionDialog
          next={(version?.number ?? 0) + 1}
          onClose={() => setSaving(false)}
          onSave={async (summary) => {
            await api.demo.saveVersion(demoRef, summary);
            setSaving(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 font-medium ${props.active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {props.children}
    </button>
  );
}

function EmptyPreview(props: { running: boolean; pendingStructure: boolean; onGenerate: () => void }) {
  const t = useT();
  return (
    <div className="m-auto max-w-sm text-center">
      {props.running ? (
        <>
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
          <p className="font-medium">{t("Claude is building the first version")}</p>
          <p className="mt-1 text-muted">{t("This usually takes a few minutes. Follow along in the panel on the right.")}</p>
        </>
      ) : props.pendingStructure ? (
        <>
          <p className="font-medium">{t("Structure ready for review")}</p>
          <p className="mt-1 text-muted">{t("Approve it in the Claude panel, with any changes, to build the pages.")}</p>
        </>
      ) : (
        <>
          <p className="font-medium">{t("No pages yet")}</p>
          <p className="mt-1 text-muted">{t("Generate the site from the brief, or describe what you want in the Claude panel.")}</p>
          <button className="btn btn-primary mt-4" onClick={props.onGenerate}>
            {t("Generate site")}
          </button>
        </>
      )}
    </div>
  );
}

function ClaudePanel(props: {
  events: RunEvent[];
  phase: string | undefined;
  running: boolean;
  error: string | undefined;
  pendingStructure: string | undefined;
  onSend: (text: string) => Promise<void>;
  onApprove: (feedback: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Braces matter: scrollIntoView() returns a Promise in recent Chromium, and React
    // would call a returned value as the effect cleanup.
    bottom.current?.scrollIntoView({ block: "end" });
  }, [props.events.length, props.phase]);

  const send = () => {
    const t = text.trim();
    if (!t || props.running) return;
    setText("");
    void props.onSend(t);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {props.events.length === 0 && !props.running && (
          <p className="mt-6 text-center text-muted">{t('Ask Claude for changes: "make the hero more minimal", "add a pricing section"…')}</p>
        )}
        <div className="flex flex-col gap-2.5">
          {props.events.map((e, i) => (
            <EventItem key={i} event={e} />
          ))}
        </div>
        {props.pendingStructure && !props.running && (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent-soft/60 p-3">
            <p className="mb-2 font-medium">{t("Approve this structure?")}</p>
            <textarea
              className="input min-h-20 resize-y"
              placeholder={t("Optional changes: add a FAQ to Home, merge About and Team…")}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button className="btn btn-primary mt-2 w-full justify-center" onClick={() => void props.onApprove(feedback)}>
              {t("Approve and build pages")}
            </button>
          </div>
        )}
        {props.phase && (
          <div className="mt-3 flex items-center gap-2 text-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
            {props.phase}
          </div>
        )}
        {props.error && <p className="mt-3 text-danger">{props.error}</p>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line p-3">
        <textarea
          className="input min-h-[72px] resize-none"
          placeholder={t(props.running ? "Claude is working…" : "Describe a change…  (⌘↵ to send)")}
          value={text}
          disabled={props.running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex justify-end gap-2">
          {props.running ? (
            <button className="btn" onClick={props.onCancel}>
              {t("Stop")}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!text.trim()} onClick={send}>
              {t("Send")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function EventItem({ event: e }: { event: RunEvent }) {
  const t = useT();
  switch (e.type) {
    case "user":
      return <div className="ml-8 rounded-lg bg-accent-soft px-3 py-2 whitespace-pre-wrap">{e.text}</div>;
    case "assistant":
      return <Markdownish text={e.text} />;
    case "tool":
      return (
        <div className="truncate font-mono text-[11.5px] text-faint">
          {e.name} <span className="text-muted">{e.detail}</span>
        </div>
      );
    case "structure":
      return (
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <p className="mb-1 text-[12px] font-medium text-muted">{t("Proposed structure")}</p>
          <Markdownish text={e.text} />
        </div>
      );
    case "result":
      return (
        <div className={`text-[12px] ${e.ok ? "text-faint" : "text-danger"}`}>
          {e.ok ? t("Done") : t("Failed: {text}", { text: e.text })}
          {e.durationMs !== undefined && ` · ${Math.round(e.durationMs / 1000)}s`}
          {e.costUsd !== undefined && ` · $${e.costUsd.toFixed(2)}`}
        </div>
      );
    case "lint":
      return e.errors + e.warnings === 0 ? (
        <div className="text-[12px] text-ok">{t("✓ Content contract OK")}</div>
      ) : (
        <details className="text-[12px]">
          <summary className={e.errors ? "text-danger" : "text-warn"}>
            {t("Checks: {e} error(s), {w} warning(s)", { e: e.errors, w: e.warnings })}
          </summary>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted">{e.report}</pre>
        </details>
      );
    case "version":
      return <div className="text-[12px] font-medium text-ok">{t("Saved as v{n}", { n: e.number })}</div>;
    case "feedback":
      return (
        <div className="text-[12px] font-medium text-accent">
          {t("Imported client feedback on v{v}: {e} edit(s) applied, {n} note(s) for Claude", { v: e.version, e: e.edits, n: e.notes })}
        </div>
      );
    case "exported":
      return <div className="text-[12px] font-medium text-ok">{t(e.kind === "site" ? "Exported the static site: {path}" : "Exported the handoff pack: {path}", { path: e.path })}</div>;
    case "published":
      return <div className="text-[12px] font-medium text-accent">{t("Published v{n} for client review", { n: e.version })}</div>;
    case "error":
      return <div className="text-danger">{e.message}</div>;
    case "done":
      return e.ok ? <hr className="border-line" /> : null;
    case "phase":
      return null;
  }
}

function VersionsPanel({ detail }: { detail: DemoDetail }) {
  const t = useT();
  const versions = [...detail.meta.versions].reverse();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {versions.length === 0 ? (
        <p className="mt-6 text-center text-muted">{t("No versions yet. The first one is saved when the site is generated.")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {versions.map((v) => (
            <li key={v.tag} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">v{v.number}</span>
                <span className="ml-auto text-[12px] text-faint">{timeAgo(v.createdAt, t)}</span>
              </div>
              <p className="mt-0.5 text-muted">{v.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChecksPanel({ detail }: { detail: DemoDetail }) {
  const t = useT();
  const lint = detail.lint;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p className="mb-3 text-muted">
        {t("Every text and image must carry a {attr} key, so the client can edit it.", { attr: "data-pt" })}
      </p>
      {!lint ? null : lint.errors + lint.warnings === 0 ? (
        <p className="text-ok">{t("✓ No problems found.")}</p>
      ) : (
        <>
          <p className="mb-2 font-medium">
            {t("{e} error(s), {w} warning(s)", { e: lint.errors, w: lint.warnings })}
          </p>
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">{lint.report}</pre>
        </>
      )}
    </div>
  );
}

function SaveVersionDialog(props: { next: number; onClose: () => void; onSave: (summary: string) => Promise<void> }) {
  const t = useT();
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t("Save as v{n}", { n: props.next })}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {t("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await props.onSave(summary);
            }}
          >
            {t("Save version")}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="sv-summary">{t("What changed (optional)")}</label>
      <input id="sv-summary" className="input" autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("New hero, pricing section")} />
    </Modal>
  );
}

/** Minimal Markdown for Claude's messages: headings, bullets, **bold**, `code`. No HTML is injected. */
function Markdownish({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
        <code key={i} className="rounded bg-black/5 px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
  return (
    <div className="flex flex-col gap-1 leading-relaxed">
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1" />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) return <p key={i} className="mt-1 font-semibold">{inline(heading[1]!)}</p>;
        const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2" style={{ paddingLeft: bullet[1]!.length * 6 }}>
              <span className="text-faint">•</span>
              <span>{inline(bullet[2]!)}</span>
            </div>
          );
        }
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
