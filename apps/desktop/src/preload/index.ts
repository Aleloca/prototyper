import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ApplyFeedbackInput,
  BrandEventMessage,
  BrandInfo,
  BrandTokens,
  GenerateOptions,
  ReferenceItem,
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
  brand: {
    info: (client: string) => invoke<BrandInfo>("brand:info", client),
    extract: (client: string, website: string) => invoke<boolean>("brand:extract", client, website),
    saveTokens: (client: string, tokens: BrandTokens) => invoke<void>("brand:saveTokens", client, tokens),
    saveMd: (client: string, text: string) => invoke<void>("brand:saveMd", client, text),
  },
  /** Absolute path of a file dropped or picked in the renderer. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onBrandEvent: (cb: (msg: BrandEventMessage) => void) => {
    const listener = (_: unknown, msg: BrandEventMessage) => cb(msg);
    ipcRenderer.on("brand:event", listener);
    return () => void ipcRenderer.off("brand:event", listener);
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
    generate: (ref: DemoRef, opts: GenerateOptions) => invoke<void>("demo:generate", ref, opts),
    references: (ref: DemoRef) => invoke<ReferenceItem[]>("demo:references", ref),
    addReferenceFiles: (ref: DemoRef, paths: string[]) => invoke<void>("demo:addReferenceFiles", ref, paths),
    addReferenceImage: (ref: DemoRef, data: Uint8Array, ext: string) => invoke<void>("demo:addReferenceImage", ref, data, ext),
    addReferenceUrl: (ref: DemoRef, url: string, note: string) => invoke<void>("demo:addReferenceUrl", ref, url, note),
    setReferenceNote: (ref: DemoRef, file: string, note: string) => invoke<void>("demo:setReferenceNote", ref, file, note),
    removeReference: (ref: DemoRef, file: string) => invoke<void>("demo:removeReference", ref, file),
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
