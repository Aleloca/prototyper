import { useEffect, useState } from "react";
import type { ContentValue, DemoRef, FeedbackEdit, FeedbackRound } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage, timeAgo } from "../format";
import { useT } from "../i18n";

export function FeedbackDialog(props: { demoRef: DemoRef; nextVersion: number; onClose: () => void; onStarted: () => void }) {
  const t = useT();
  const [round, setRound] = useState<FeedbackRound | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [edits, setEdits] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | undefined>();

  useEffect(() => {
    api.demo.loadFeedback(props.demoRef).then(
      (r) => {
        setRound(r);
        setEdits(new Set(r.edits.map((e) => e.key)));
        setNotes(new Set(r.notes.map((n) => n.id)));
      },
      (e) => setError(errorMessage(e)),
    );
  }, [props.demoRef]);

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const apply = async (generate: boolean) => {
    if (!round) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.demo.applyFeedback(props.demoRef, {
        roundId: round.roundId,
        acceptedEdits: [...edits],
        acceptedNotes: [...notes],
        extraInstructions: extra,
        generate,
      });
      props.onStarted();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const nothing = round && round.edits.length === 0 && round.notes.length === 0;

  return (
    <Modal
      title={round ? t("Client feedback on v{n}", { n: round.versionNumber }) : t("Client feedback")}
      width="max-w-4xl"
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-danger">{error}</span>}
          <button className="btn" onClick={props.onClose}>{t("Cancel")}</button>
          <button className="btn" disabled={!round || busy || edits.size === 0} onClick={() => void apply(false)} title={t("Apply the accepted edits to the demo without asking Claude")}>
            {t("Apply edits only")}
          </button>
          <button className="btn btn-primary" disabled={!round || busy || (edits.size === 0 && notes.size === 0 && !extra.trim())} onClick={() => void apply(true)}>
            {busy ? t("Starting…") : t("Apply and generate v{n}", { n: props.nextVersion })}
          </button>
        </>
      }
    >
      {!round && !error && (
        <div className="flex items-center gap-2 py-8 text-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
          {t("Downloading feedback and preparing screenshots…")}
        </div>
      )}
      {round && (
        <div className="flex flex-col gap-6">
          <p className="text-muted">
            {round.status === "submitted"
              ? t("Sent by {name} {ago}.", { name: round.submittedBy ?? t("the client"), ago: round.submittedAt ? timeAgo(round.submittedAt, t) : "" })
              : t("The client has not pressed “I'm done” yet: applying now closes the round, and later changes on this version will be lost.")}{" "}
            {t("Accepted edits are written into the pages as they are; accepted notes go to Claude. The client's link is closed for edits while you work on the next version.")}
          </p>
          {nothing && <p className="font-medium">{t("No edits or notes in this round.")}</p>}

          {round.edits.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                {t("Direct edits")} <span className="font-normal text-faint">{t("{a} of {b} accepted", { a: edits.size, b: round.edits.length })}</span>
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {round.edits.map((e) => (
                  <li key={e.key} className="flex gap-3 px-3 py-2.5">
                    <input type="checkbox" className="mt-1" aria-label={`Accept edit ${e.key}`} checked={edits.has(e.key)} onChange={() => toggle(edits, setEdits, e.key)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-[12px] text-faint">
                        <code className="font-mono text-muted">{e.key}</code>
                        <span>{e.page}</span>
                        <span className="ml-auto">{e.author}</span>
                      </div>
                      <EditDiff edit={e} onZoom={setZoom} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {round.notes.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                {t("Notes for Claude")} <span className="font-normal text-faint">{t("{a} of {b} included", { a: notes.size, b: round.notes.length })}</span>
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {round.notes.map((n, i) => (
                  <li key={n.id} className="flex gap-3 px-3 py-2.5">
                    <input type="checkbox" className="mt-1" aria-label={`Include note ${i + 1}`} checked={notes.has(n.id)} onChange={() => toggle(notes, setNotes, n.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-[12px] text-faint">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[#f05a28] text-[11px] font-semibold text-white">{i + 1}</span>
                        <span>{n.page}</span>
                        {n.context && <span className="truncate">{t("on {context}", { context: n.context })}</span>}
                        <span className="ml-auto shrink-0">{n.author}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{n.text}</p>
                    </div>
                    {n.screenshot && (
                      <button className="shrink-0" onClick={() => setZoom(n.screenshot)} aria-label="Enlarge screenshot">
                        <img src={n.screenshot} alt="" className="h-20 w-32 rounded border border-line object-cover" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <label className="label" htmlFor="fb-extra">{t("Your instructions for v{n} (optional, they take priority over the notes)", { n: props.nextVersion })}</label>
            <textarea id="fb-extra" className="input min-h-20 resize-y" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t("e.g. keep the hero as it is; the client confirmed by phone they want a FAQ section")} />
          </section>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-8" onClick={() => setZoom(undefined)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </Modal>
  );
}

function EditDiff({ edit, onZoom }: { edit: FeedbackEdit; onZoom: (src: string) => void }) {
  const v = edit.value;
  if (v.kind === "image" || v.kind === "bg") {
    return (
      <div className="mt-1.5 flex items-center gap-3">
        {edit.beforePreview && <img src={edit.beforePreview} alt="Before" className="h-16 w-24 rounded border border-line object-cover opacity-60" />}
        <span className="text-faint">→</span>
        {edit.preview && (
          <button onClick={() => onZoom(edit.preview!)} aria-label="Enlarge new image">
            <img src={edit.preview} alt="After" className="h-16 w-24 rounded border border-line object-cover" />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1 grid gap-0.5">
      <span className="text-muted line-through decoration-faint">{plain(edit.before)}</span>
      <span>{plain(v)}</span>
    </div>
  );
}

function plain(v: ContentValue | null): string {
  if (!v) return "—";
  switch (v.kind) {
    case "text":
      return v.text;
    case "rich":
      return v.html.replace(/<[^>]+>/g, "");
    case "link":
      return `${v.label} (${v.href})`;
    case "image":
    case "bg":
      return v.src;
  }
}
