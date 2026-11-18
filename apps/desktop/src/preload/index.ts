import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplyFeedbackInput,
  ClaudeCheck,
  FeedbackRound,
  ClientInfo,
  DemoDetail,
  DemoEventMessage,
  DemoMeta,
  DemoRef,
  LibraryClient,
  NewClientInput,
  NewDemoInput,
  RoundSummary,
  RunEvent,
  Settings,
  ShareInfo,
  ShareTarget,
  ShareTargetInput,
} from "../common/types";

const invoke = <R>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<R>;

const api = {
  settings: {
    get: () => invoke<Settings>("settings:get"),
    set: (patch: Partial<Settings>) => invoke<Settings>("settings:set", patch),
    chooseFolder: () => invoke<string | undefined>("settings:chooseFolder"),
  },
  claude: {
    check: () => invoke<ClaudeCheck>("claude:check"),
  },
  share: {
    targets: () => invoke<(ShareTarget & { hasToken: boolean })[]>("share:targets"),
    saveTarget: (input: ShareTargetInput) => invoke<ShareTarget>("share:saveTarget", input),
    removeTarget: (id: string) => invoke<void>("share:removeTarget", id),
    testTarget: (id: string) => invoke<boolean>("share:testTarget", id),
    poll: () => invoke<void>("share:poll"),
  },
  library: {
    list: () => invoke<LibraryClient[]>("library:list"),
    createClient: (input: NewClientInput) => invoke<ClientInfo>("library:createClient", input),
  },
  demo: {
    create: (input: NewDemoInput) => invoke<DemoMeta>("demo:create", input),
    detail: (ref: DemoRef) => invoke<DemoDetail>("demo:detail", ref),
    log: (ref: DemoRef) => invoke<RunEvent[]>("demo:log", ref),
    open: (ref: DemoRef) => invoke<void>("demo:open", ref),
    close: (ref: DemoRef) => invoke<void>("demo:close", ref),
    generate: (ref: DemoRef, opts: { structureFirst: boolean }) => invoke<void>("demo:generate", ref, opts),
    approveStructure: (ref: DemoRef, feedback: string) => invoke<void>("demo:approveStructure", ref, feedback),
    chat: (ref: DemoRef, text: string) => invoke<void>("demo:chat", ref, text),
    cancel: (ref: DemoRef) => invoke<void>("demo:cancel", ref),
    saveVersion: (ref: DemoRef, summary: string) => invoke<void>("demo:saveVersion", ref, summary),
    publish: (ref: DemoRef, targetId: string) => invoke<ShareInfo>("demo:publish", ref, targetId),
    setShareStatus: (ref: DemoRef, status: ShareInfo["status"]) => invoke<void>("demo:setShareStatus", ref, status),
    rounds: (ref: DemoRef) => invoke<RoundSummary[]>("demo:rounds", ref),
    loadFeedback: (ref: DemoRef) => invoke<FeedbackRound>("demo:loadFeedback", ref),
    applyFeedback: (ref: DemoRef, input: ApplyFeedbackInput) => invoke<void>("demo:applyFeedback", ref, input),
    openFolder: (ref: DemoRef) => invoke<string>("demo:openFolder", ref),
    openInBrowser: (ref: DemoRef) => invoke<void>("demo:openInBrowser", ref),
    openTerminal: (ref: DemoRef) => invoke<void>("demo:openTerminal", ref),
  },
  onDemoEvent: (cb: (msg: DemoEventMessage) => void) => {
    const listener = (_: unknown, msg: DemoEventMessage) => cb(msg);
    ipcRenderer.on("demo:event", listener);
    return () => void ipcRenderer.off("demo:event", listener);
  },
  onOpenDemo: (cb: (ref: DemoRef) => void) => {
    const listener = (_: unknown, ref: DemoRef) => cb(ref);
    ipcRenderer.on("app:openDemo", listener);
    return () => void ipcRenderer.off("app:openDemo", listener);
  },
  onDemoChanged: (cb: (ref: DemoRef) => void) => {
    const listener = (_: unknown, ref: DemoRef) => cb(ref);
    ipcRenderer.on("demo:changed", listener);
    return () => void ipcRenderer.off("demo:changed", listener);
  },
};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
