import { useEffect, useState } from "react";
import type { ClaudeCheck, Settings } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";

const MODELS = [
  { value: "", label: "Claude Code default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku (fast, for quick tests)" },
];

export function SettingsDialog(props: { claude: ClaudeCheck | undefined; onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [check, setCheck] = useState(props.claude);

  useEffect(() => void api.settings.get().then(setSettings), []);

  const update = async (patch: Partial<Settings>) => setSettings(await api.settings.set(patch));

  return (
    <Modal title="Settings" onClose={props.onClose} footer={<button className="btn btn-primary" onClick={props.onClose}>Done</button>}>
      {settings && (
        <div className="flex flex-col gap-5">
          <div>
            <span className="label">Library folder</span>
            <div className="flex gap-2">
              <input className="input font-mono text-[12px]" readOnly value={settings.libraryRoot} />
              <button
                className="btn shrink-0"
                onClick={async () => {
                  const dir = await api.settings.chooseFolder();
                  if (dir) await update({ libraryRoot: dir });
                }}
              >
                Change…
              </button>
            </div>
            <p className="mt-1 text-[12px] text-faint">Plain folders and files; you can open any demo with Claude Code directly.</p>
          </div>

          <div>
            <label className="label" htmlFor="st-claude">Claude Code binary</label>
            <div className="flex gap-2">
              <input
                id="st-claude"
                className="input font-mono text-[12px]"
                placeholder="Auto-detect"
                defaultValue={settings.claudePath ?? ""}
                onBlur={(e) => void update({ claudePath: e.target.value.trim() })}
              />
              <button className="btn shrink-0" onClick={async () => setCheck(await api.claude.check())}>
                Check
              </button>
            </div>
            {check && (
              <p className={`mt-1 text-[12px] ${check.ok ? "text-ok" : "text-danger"}`}>
                {check.ok ? `✓ ${check.version} — ${check.path}` : check.error}
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="st-model">Model</label>
            <select id="st-model" className="input" value={settings.model ?? ""} onChange={(e) => void update({ model: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}
