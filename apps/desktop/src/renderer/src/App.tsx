import { useCallback, useEffect, useState } from "react";
import type { ClaudeCheck, DemoRef } from "@common/types";
import { api } from "./api";
import { Library } from "./screens/Library";
import { Workspace } from "./screens/Workspace";
import { SettingsDialog } from "./screens/SettingsDialog";

type Screen = { name: "library" } | { name: "demo"; ref: DemoRef; autostart?: { structureFirst: boolean } };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "library" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [claude, setClaude] = useState<ClaudeCheck | undefined>();

  const checkClaude = useCallback(() => {
    void api.claude.check().then(setClaude);
  }, []);
  useEffect(checkClaude, [checkClaude]);

  return (
    <div className="flex h-full flex-col">
      {claude && !claude.ok && (
        <div className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 pl-24 text-danger">
          <span className="font-medium">Claude Code unavailable.</span>
          <span className="truncate">{claude.error}</span>
          <button className="btn ml-auto" onClick={() => setSettingsOpen(true)}>
            Settings
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
          }}
        />
      )}
    </div>
  );
}
