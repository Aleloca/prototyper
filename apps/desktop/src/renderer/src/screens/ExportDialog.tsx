import { useState } from "react";
import type { DemoDetail, DemoRef, ExportOptions } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { errorMessage } from "../format";

export function ExportDialog(props: { demoRef: DemoRef; detail: DemoDetail; onClose: () => void; onStarted: () => void }) {
  const [kind, setKind] = useState<ExportOptions["kind"]>("handoff");
  const [stripKeys, setStripKeys] = useState(true);
  const [withHandoffDoc, setWithHandoffDoc] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const version = props.detail.meta.versions.at(-1);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const path = await api.demo.exportZip(props.demoRef, { kind, stripKeys, withHandoffDoc: kind === "handoff" && withHandoffDoc });
      if (path) props.onStarted();
      else setBusy(false);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const Option = (p: { value: ExportOptions["kind"]; title: string; text: string }) => (
    <label className={`flex cursor-default items-start gap-3 rounded-lg border px-3 py-2.5 ${kind === p.value ? "border-accent bg-accent-soft/50" : "border-line"}`}>
      <input type="radio" name="export-kind" className="mt-1" checked={kind === p.value} onChange={() => setKind(p.value)} />
      <span>
        <span className="font-medium">{p.title}</span>
        <span className="block text-muted">{p.text}</span>
      </span>
    </label>
  );

  return (
    <Modal
      title="Export"
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-danger">{error}</span>}
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !props.detail.hasPages} onClick={() => void run()}>
            {busy ? "Starting…" : "Export…"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {props.detail.unsavedChanges && version && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-warn">There are changes after v{version.number}: the export includes them. Save a version first if the client hasn't seen them.</p>
        )}
        <Option value="handoff" title="Developer handoff pack" text="The prototype plus everything needed to start the real project: approved copy (content.json), brand and tokens, review history, CLAUDE.md." />
        <Option value="site" title="Static site" text="The prototype as plain HTML, CSS and images, ready to host anywhere." />
        <div className="mt-1 flex flex-col gap-2">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-0.5" checked={stripKeys} onChange={(e) => setStripKeys(e.target.checked)} />
            <span>
              Remove the <code className="font-mono text-[12px]">data-pt</code> attributes from the HTML
              <span className="block text-[12px] text-muted">They are only needed for client editing. content.json keeps the keys either way.</span>
            </span>
          </label>
          {kind === "handoff" && (
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5" checked={withHandoffDoc} onChange={(e) => setWithHandoffDoc(e.target.checked)} />
              <span>
                Ask Claude to write HANDOFF.md
                <span className="block text-[12px] text-muted">Sitemap, sections, components, open content, integrations and a stack suggestion. Takes a minute or two.</span>
              </span>
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
