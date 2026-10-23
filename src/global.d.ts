export {};

type Unsub = () => void;

declare global {
  /** package.json version, injected by Vite */
  const __ICUT_VERSION__: string;
  interface ProviderStatus {
    installed: boolean;
    loggedIn: boolean;
    apiKey: boolean;
    ready: boolean;
    method?: string;
    email?: string;
    install?: string;
    error?: string;
  }
  interface ProviderModel {
    id: string;
    label: string;
    desc?: string;
    efforts?: string[];
    defaultEffort?: string;
  }
}

declare global {
  interface Window {
    icut: {
      openMediaDialog(): Promise<string[]>;
      saveDialog(opts: any): Promise<string | null>;
      openProjectDialog(): Promise<string | null>;
      chooseFile(opts: any): Promise<string | null>;
      pathForFile(file: File): string;
      exists(p: string): Promise<boolean>;
      writePng(p: string, data: ArrayBuffer): Promise<void>;
      reveal(p: string): Promise<void>;
      openExternal(url: string): Promise<void>;
      importMedia(items: { id: string; path: string }[]): Promise<{ id: string; ok: boolean; info?: any; error?: string }[]>;
      refreshAssets(o: { id: string; path: string; info: any }): Promise<void>;
      onMediaUpdate(cb: (e: { id: string; patch: any }) => void): Unsub;
      saveProject(path: string, data: any): Promise<boolean>;
      loadProject(path: string): Promise<{ data: any; missing: string[] }>;
      syncProject(p: any): void;
      setDirty(d: boolean): void;
      exportStart(o: any): Promise<{ audioOnly: boolean }>;
      exportFrame(buf: ArrayBuffer): Promise<void>;
      exportFinish(): Promise<{ path: string; size: number }>;
      exportCancel(): Promise<void>;
      exportWcStart(o: { ext: 'mp4' | 'webm' }): Promise<{ tmp: string }>;
      exportWcChunk(o: { position: number; data: Uint8Array }): Promise<void>;
      exportWcFinish(o: { outPath: string; audio: ArrayBuffer | null; format: string }): Promise<{ path: string; size: number }>;
      exportWcCancel(): Promise<void>;
      agentSend(p: { text: string; context?: string; images?: { mediaType: string; data: string }[] }): Promise<void>;
      agentInterrupt(): Promise<void>;
      agentReset(): Promise<void>;
      agentSetModel(o: { model: string; effort: string }): Promise<void>;
      listSessions(): Promise<{ sessionId: string; title: string; lastModified: number; cwd?: string; gitBranch?: string }[]>;
      sessionTranscript(id: string): Promise<{ text: string; messages: number }>;
      sessionContinue(id: string): Promise<{ sessionId: string }>;
      agentSetBypass(on: boolean): Promise<void>;
      agentSetProvider(p: 'claude' | 'codex' | 'cursor' | 'relay'): Promise<any>;
      providerStatus(p: 'claude' | 'codex' | 'cursor' | 'relay'): Promise<ProviderStatus>;
      onRelayStatus(cb: (st: ProviderStatus) => void): Unsub;
      providerLogin(p: 'claude' | 'codex' | 'cursor'): Promise<{ ok: boolean; out: string }>;
      providerCancelLogin(): Promise<void>;
      providerInstall(p: 'codex'): Promise<{ ok: boolean; out: string }>;
      engineTool(name: 'detect_scenes' | 'detect_silence' | 'transcribe' | 'analyze_loudness', args: any): Promise<{ content: any[]; isError?: boolean }>;
      providerModels(p: 'claude' | 'codex' | 'cursor'): Promise<ProviderModel[]>;
      onExternalAgents(cb: (list: { id: string; name: string; since: number; last: number; lastTool?: string; calls: number }[]) => void): Unsub;
      permissionReply(r: { id: number; allow: boolean; always?: boolean }): void;
      onAgentEvent(cb: (e: any) => void): Unsub;
      onToolActivity(cb: (e: { name: string; args: any }) => void): Unsub;
      onToolInvoke(cb: (e: { id: number; name: string; args: any }) => void): Unsub;
      toolResult(id: number, result: any): void;
      getSettings(): Promise<any>;
      setSettings(patch: any): Promise<any>;
      appInfo(): Promise<{ version: string; mcpServerPath: string; bridgeFile: string; ffmpegOk: boolean; userData: string; documents: string; startupProject: string | null }>;
      downloadWhisper(name: string): Promise<string>;
      onWhisperProgress(cb: (e: { got: number; total: number }) => void): Unsub;
      onCompositionProgress(cb: (j: { id: number; name: string; format: string; progress: number; line: string; done?: boolean; error?: string }) => void): Unsub;
      onToast(cb: (e: { message: string }) => void): Unsub;
      authStatus(): Promise<{ installed: boolean; loggedIn: boolean; authMethod?: string; email?: string; apiKey: boolean; ready: boolean; source?: string; path?: string; install?: string }>;
      authLogin(o?: { console?: boolean }): Promise<{ ok: boolean; out: string }>;
      authCancel(): Promise<void>;
      onAuthOutput(cb: (line: string) => void): Unsub;
      devtools(): void;
      reload(): void;
    };
  }
}
