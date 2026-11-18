import { useEffect, useState } from "react";
import type { ShareTarget } from "@common/types";
import { api } from "../api";
import { errorMessage } from "../format";
import { useT } from "../i18n";

type Target = ShareTarget & { hasToken: boolean };

/** Settings section: the domains (share servers) demos can be published to. */
export function ShareTargets() {
  const tr = useT();
  const [targets, setTargets] = useState<Target[]>([]);
  const [editing, setEditing] = useState<Partial<Target> & { adminToken?: string } | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  const load = () => void api.share.targets().then(setTargets);
  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    setError(undefined);
    try {
      const t = await api.share.saveTarget({
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name ?? "",
        baseUrl: editing.baseUrl ?? "",
        ...(editing.adminToken ? { adminToken: editing.adminToken } : {}),
      });
      setEditing(null);
      load();
      void test(t.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const test = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: tr("Testing…") }));
    try {
      await api.share.testTarget(id);
      setStatus((s) => ({ ...s, [id]: tr("✓ Connected") }));
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: errorMessage(e) }));
    }
  };

  return (
    <div>
      <span className="label">{tr("Share domains")}</span>
      <p className="mb-2 text-[12px] text-faint">
        {tr("Prototyper share servers where demos are published for clients. Each demo picks one. Admin tokens are stored in the macOS keychain.")}
      </p>
      <div className="flex flex-col gap-2">
        {targets.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.name}</div>
              <div className="truncate font-mono text-[12px] text-muted">{t.baseUrl}</div>
              {status[t.id] && <div className={`text-[12px] ${status[t.id]!.startsWith("✓") ? "text-ok" : status[t.id] === tr("Testing…") ? "text-muted" : "text-danger"}`}>{status[t.id]}</div>}
            </div>
            <button className="btn btn-ghost" onClick={() => void test(t.id)}>{tr("Test")}</button>
            <button className="btn btn-ghost" onClick={() => setEditing({ ...t })}>{tr("Edit")}</button>
            <button
              className="btn btn-ghost text-danger"
              onClick={async () => {
                await api.share.removeTarget(t.id);
                load();
              }}
            >
              {tr("Remove")}
            </button>
          </div>
        ))}
        {editing ? (
          <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent-soft/40 p-3">
            <input className="input" placeholder={tr("Name (e.g. Preview)")} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="input font-mono text-[12px]" placeholder="https://preview.example.com" value={editing.baseUrl ?? ""} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
            <input
              className="input font-mono text-[12px]"
              type="password"
              placeholder={tr(editing.id ? "Admin token (leave empty to keep the current one)" : "Admin token")}
              value={editing.adminToken ?? ""}
              onChange={(e) => setEditing({ ...editing, adminToken: e.target.value })}
            />
            {error && <p className="text-[12px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => (setEditing(null), setError(undefined))}>{tr("Cancel")}</button>
              <button className="btn btn-primary" onClick={() => void save()}>{tr("Save")}</button>
            </div>
          </div>
        ) : (
          <button className="btn self-start" onClick={() => setEditing({})}>{tr("Add share domain")}</button>
        )}
      </div>
    </div>
  );
}
