import { useEffect, useState } from "react";
import type { DemoDetail, DemoRef, RoundSummary, ShareTarget } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage, timeAgo } from "../format";

const ROUND_LABEL: Record<RoundSummary["status"], string> = {
  open: "Client reviewing",
  submitted: "Feedback submitted",
  imported: "Feedback imported",
};

export function ShareDialog(props: { demoRef: DemoRef; detail: DemoDetail; onClose: () => void; onSaveVersion: () => void; onReview?: () => void }) {
  const { meta, unsavedChanges } = props.detail;
  const share = meta.share;
  const latest = meta.versions.at(-1);
  const [targets, setTargets] = useState<(ShareTarget & { hasToken: boolean })[] | undefined>();
  const [targetId, setTargetId] = useState(share?.targetId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [rounds, setRounds] = useState<RoundSummary[] | undefined>();

  useEffect(() => {
    void api.share.targets().then((t) => {
      setTargets(t);
      if (!targetId && t[0]) setTargetId(t[0].id);
    });
    if (share) void api.demo.rounds(props.demoRef).then(setRounds, () => setRounds(undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const info = await api.demo.publish(props.demoRef, targetId);
      await navigator.clipboard.writeText(info.url).then(() => setCopied(true), () => {});
      setRounds(await api.demo.rounds(props.demoRef).catch(() => undefined));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: "open" | "readonly" | "revoked") => {
    setError(undefined);
    try {
      await api.demo.setShareStatus(props.demoRef, status);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const copy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const needsPublish = !share || (latest && latest.number > share.publishedVersion);
  const target = targets?.find((t) => t.id === (share?.targetId ?? targetId));
  const current = rounds?.at(-1);

  return (
    <Modal title="Share with the client" width="max-w-xl" onClose={props.onClose} footer={<button className="btn" onClick={props.onClose}>Close</button>}>
      <div className="flex flex-col gap-5">
        {share && (
          <div>
            <span className="label">Client link</span>
            <div className="flex gap-2">
              <input className="input font-mono text-[12px]" readOnly value={share.url} onFocus={(e) => e.target.select()} />
              <button className="btn shrink-0" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
              <a className="btn shrink-0" href={share.url} target="_blank" rel="noreferrer">Open</a>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              v{share.publishedVersion} published {timeAgo(share.publishedAt)} on {target?.name ?? "an unknown domain"}.
              {share.status === "readonly" && " Read-only: the client can look but not change anything."}
              {share.status === "revoked" && " Revoked: the link no longer works."}
            </p>
          </div>
        )}

        {share && current && (
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">Round for v{current.versionNumber}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${current.status === "submitted" ? "bg-warn/15 text-warn" : "bg-black/5 text-muted"}`}>
                {ROUND_LABEL[current.status]}
              </span>
            </div>
            <p className="mt-1 text-muted">
              {current.edits} edit{current.edits === 1 ? "" : "s"} · {current.comments} note{current.comments === 1 ? "" : "s"}
              {current.submittedAt && ` · sent by ${current.submittedBy ?? "the client"} ${timeAgo(current.submittedAt)}`}
            </p>
            {current.status !== "imported" && current.edits + current.comments > 0 && props.onReview && (
              <button className="btn mt-2" onClick={props.onReview}>Review feedback</button>
            )}
          </div>
        )}

        {needsPublish && (
          <div>
            {!share && (
              <>
                <label className="label" htmlFor="sh-target">Share domain</label>
                {targets && targets.length === 0 ? (
                  <p className="text-muted">Add a share domain in Settings first.</p>
                ) : (
                  <select id="sh-target" className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    {targets?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.baseUrl.replace(/^https?:\/\//, "")}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}

            {unsavedChanges ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-warn/10 px-3 py-2.5 text-warn">
                <span className="flex-1">There are changes after {latest ? `v${latest.number}` : "the last version"}. Save a version to publish them.</span>
                <button className="btn" onClick={props.onSaveVersion}>Save version</button>
              </div>
            ) : (
              latest && (
                <button className="btn btn-primary mt-3" disabled={busy || !targetId} onClick={() => void publish()}>
                  {busy ? "Publishing…" : share ? `Publish v${latest.number} on the same link` : `Publish v${latest.number} and copy link`}
                </button>
              )
            )}
            {share && !unsavedChanges && <p className="mt-1.5 text-[12px] text-faint">The client keeps the same link and sees what changed in v{latest?.number}.</p>}
          </div>
        )}

        {share && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {share.status !== "open" && <button className="btn" onClick={() => void setStatus("open")}>Reopen for edits</button>}
            {share.status === "open" && <button className="btn" onClick={() => void setStatus("readonly")}>Make read-only</button>}
            {share.status !== "revoked" && <button className="btn text-danger" onClick={() => void setStatus("revoked")}>Revoke link</button>}
          </div>
        )}

        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
