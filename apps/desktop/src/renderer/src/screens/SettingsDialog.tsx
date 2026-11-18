import { useEffect, useState } from "react";
import type { ClaudeCheck, Settings } from "@common/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { ShareTargets } from "../components/ShareTargets";
import { useT } from "../i18n";

const MODELS = [ // labels are translated with t()
  { value: "", label: "Claude Code default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku (fast, for quick tests)" },
];

export function SettingsDialog(props: { claude: ClaudeCheck | undefined; onClose: () => void }) {
  const t = useT();
  const [settings, setSettings] = useState<Settings | undefined>();
  const [check, setCheck] = useState(props.claude);

  useEffect(() => void api.settings.get().then(setSettings), []);

  const update = async (patch: Partial<Settings>) => setSettings(await api.settings.set(patch));

  return (
    <Modal title={t("Settings")} width="max-w-xl" onClose={props.onClose} footer={<button className="btn btn-primary" onClick={props.onClose}>{t("Done")}</button>}>
      {settings && (
        <div className="flex flex-col gap-5">
          <div>
            <span className="label">{t("Library folder")}</span>
            <div className="flex gap-2">
              <input className="input font-mono text-[12px]" readOnly value={settings.libraryRoot} />
              <button
                className="btn shrink-0"
                onClick={async () => {
                  const dir = await api.settings.chooseFolder();
                  if (dir) await update({ libraryRoot: dir });
                }}
              >
                {t("Change…")}
              </button>
            </div>
            <p className="mt-1 text-[12px] text-faint">{t("Plain folders and files; you can open any demo with Claude Code directly.")}</p>
          </div>

          <div>
            <label className="label" htmlFor="st-claude">{t("Claude Code binary")}</label>
            <div className="flex gap-2">
              <input
                id="st-claude"
                className="input font-mono text-[12px]"
                placeholder={t("Auto-detect")}
                defaultValue={settings.claudePath ?? ""}
                onBlur={(e) => void update({ claudePath: e.target.value.trim() })}
              />
              <button className="btn shrink-0" onClick={async () => setCheck(await api.claude.check())}>
                {t("Check")}
              </button>
            </div>
            {check && (
              <p className={`mt-1 text-[12px] ${check.ok ? "text-ok" : "text-danger"}`}>
                {check.ok ? `✓ ${check.version} — ${check.path}` : check.error}
              </p>
            )}
          </div>

          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-0.5" checked={!!settings.isolateClaude} onChange={(e) => void update({ isolateClaude: e.target.checked })} />
            <span>
              <span className="font-medium">{t("Isolate Claude from your global configuration")}</span>
              <span className="block text-[12px] text-muted">
                {t("Runs ignore your user-level Claude Code settings, hooks, plugins and MCP servers, for more predictable results. Your login is unaffected.")}
              </span>
            </span>
          </label>

          <ShareTargets />

          <div>
            <label className="label" htmlFor="st-model">{t("Model")}</label>
            <select id="st-model" className="input" value={settings.model ?? ""} onChange={(e) => void update({ model: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {t(m.label)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="st-lang">{t("Interface language")}</label>
            <select
              id="st-lang"
              className="input"
              value={settings.uiLanguage ?? "auto"}
              onChange={(e) => void update({ uiLanguage: e.target.value as NonNullable<Settings["uiLanguage"]> })}
            >
              <option value="auto">{t("Same as system")}</option>
              <option value="en">English</option>
              <option value="it">Italiano</option>
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}
