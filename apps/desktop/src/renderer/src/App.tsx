import { useCallback, useEffect, useState } from "react";
import type { ClaudeCheck, DemoRef, GenerateOptions, Settings } from "@common/types";
import { api } from "./api";
import { I18nProvider, detectLang, useT } from "./i18n";
import { Library } from "./screens/Library";
import { Workspace } from "./screens/Workspace";
import { SettingsDialog } from "./screens/SettingsDialog";

type Screen = { name: "library" } | { name: "demo"; ref: DemoRef; autostart?: GenerateOptions };

export function App() {
  const [uiLanguage, setUiLanguage] = useState<Settings["uiLanguage"]>();
  const loadLanguage = useCallback(() => void api.settings.get().then((s) => setUiLanguage(s.uiLanguage ?? "auto")), []);
  useEffect(loadLanguage, [loadLanguage]);
  if (!uiLanguage) return null;
  return (
    <I18nProvider lang={detectLang(uiLanguage)}>
      <Shell onSettingsClosed={loadLanguage} />
    </I18nProvider>
  );
}

function Shell(props: { onSettingsClosed: () => void }) {
  const t = useT();
  const [screen, setScreen] = useState<Screen>({ name: "library" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [claude, setClaude] = useState<ClaudeCheck | undefined>();

  const checkClaude = useCallback(() => {
    void api.claude.check().then(setClaude);
  }, []);
  useEffect(checkClaude, [checkClaude]);
  // Clicking a "feedback received" notification opens that demo.
  useEffect(() => api.onOpenDemo((ref) => setScreen({ name: "demo", ref })), []);

  return (
    <div className="flex h-full flex-col">
      {claude && !claude.ok && (
        <div className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 pl-24 text-danger">
          <span className="font-medium">{t("Claude Code unavailable.")}</span>
          <span className="truncate">{claude.error}</span>
          <button className="btn ml-auto" onClick={() => setSettingsOpen(true)}>
            {t("Settings")}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {screen.name === "library" ? (
          <Library
            onOpen={(ref, autostart) => setScreen({ name: "demo", ref, ...(autostart ? { autostart } : {}) })}
            onSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <Workspace
            key={`${screen.ref.client}/${screen.ref.demo}`}
            demoRef={screen.ref}
            {...(screen.autostart ? { autostart: screen.autostart } : {})}
            onBack={() => setScreen({ name: "library" })}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsDialog
          claude={claude}
          onClose={() => {
            setSettingsOpen(false);
            checkClaude();
            props.onSettingsClosed();
          }}
        />
      )}
    </div>
  );
}
