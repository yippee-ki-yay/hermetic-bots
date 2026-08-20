/**
 * The complete renderer-visible API surface. Every method maps to one
 * allowlisted, zod-validated IPC channel; there is no generic invoke,
 * fetch, path, or exec bridge (spec §11.2).
 */
import type {
  AppPreferences,
  BotSummary,
  Capabilities,
  ConnectionConfigPublic,
  ConnectionSummary,
  CreateBotResult,
  HostTrustPrompt,
  LogLine,
  OrbDefinition,
  PushEnvelope,
  TelegramStatus,
  ThreadSummary,
  TranscriptEvent,
} from '@shared/contracts';
import type { PublicError } from '@shared/errors';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: PublicError };

export interface ConnectionStatePayload {
  connection: ConnectionSummary;
  capabilities: Capabilities;
  trustPrompt: HostTrustPrompt | null;
  configured: boolean;
  storedConfig: ConnectionConfigPublic | null;
}

export interface ConnectInput {
  label: string;
  host: string;
  port: number;
  user: string;
  authMethod: 'agent' | 'key-file' | 'ssh-config-host';
  keyPath?: string;
  sshConfigHost?: string;
  remotePort: number;
}

export interface HermesApi {
  connection: {
    get(): Promise<IpcResult<ConnectionStatePayload>>;
    connect(config: ConnectInput): Promise<IpcResult<ConnectionSummary>>;
    reconnect(): Promise<IpcResult<ConnectionSummary>>;
    /** Ask main to re-push current state; heals events missed during load. */
    sync(): Promise<IpcResult<boolean>>;
    disconnect(): Promise<IpcResult<ConnectionSummary>>;
    confirmHostKey(accept: boolean): Promise<IpcResult<ConnectionSummary>>;
    test(): Promise<IpcResult<ConnectionSummary>>;
    diagnostics(): Promise<IpcResult<string>>;
    copyDiagnostics(): Promise<IpcResult<boolean>>;
  };
  prefs: {
    get(): Promise<IpcResult<AppPreferences>>;
    set(prefs: AppPreferences): Promise<IpcResult<AppPreferences>>;
  };
  route: {
    get(): Promise<IpcResult<string | null>>;
    set(route: string): Promise<IpcResult<boolean>>;
  };
  drafts: {
    get(key: string): Promise<IpcResult<string | null>>;
    set(key: string, text: string): Promise<IpcResult<boolean>>;
  };
  privacy: {
    clearLocal(): Promise<IpcResult<boolean>>;
  };
  external: {
    open(url: string): Promise<IpcResult<boolean>>;
  };
  bots: {
    list(): Promise<IpcResult<BotSummary[]>>;
    refresh(): Promise<IpcResult<BotSummary[]>>;
    create(input: {
      name: string;
      displayName: string;
      role?: string;
      description?: string;
      orb: OrbDefinition;
      soul?: string;
      provider?: string;
      model?: string;
      cloneFrom?: string | null;
      keepSkills?: string[];
    }): Promise<IpcResult<CreateBotResult>>;
    delete(profileName: string, confirmation: string): Promise<IpcResult<boolean>>;
    rename(profileName: string, newName: string): Promise<IpcResult<boolean>>;
    setDescription(profileName: string, description: string): Promise<IpcResult<boolean>>;
    setOrb(input: {
      profileName: string;
      displayName?: string;
      role?: string;
      orb?: OrbDefinition;
    }): Promise<IpcResult<boolean>>;
    getConfig(profileName: string): Promise<
      IpcResult<{
        soul: string;
        modelInfo: unknown;
        modelOptions: unknown;
        toolsets: unknown;
        skills: unknown;
        mcp: unknown;
      }>
    >;
    setSoul(profileName: string, content: string): Promise<IpcResult<boolean>>;
    setModel(profileName: string, provider: string, model: string): Promise<IpcResult<boolean>>;
  };
  threads: {
    list(profileName: string): Promise<IpcResult<ThreadSummary[]>>;
    search(profileName: string, query: string): Promise<IpcResult<ThreadSummary[]>>;
    history(profileName: string, sessionId: string): Promise<IpcResult<TranscriptEvent[]>>;
    rename(sessionId: string, title: string): Promise<IpcResult<boolean>>;
    archive(sessionId: string, archived: boolean): Promise<IpcResult<boolean>>;
    delete(sessionId: string): Promise<IpcResult<boolean>>;
    branch(sessionId: string): Promise<IpcResult<string | null>>;
  };
  chat: {
    submit(input: {
      profileName: string;
      sessionId: string | null;
      requestId: string;
      text: string;
      mode: 'normal' | 'steer' | 'background';
    }): Promise<IpcResult<{ sessionId: string }>>;
    interrupt(sessionId: string): Promise<IpcResult<boolean>>;
    retry(requestId: string): Promise<IpcResult<boolean>>;
    transcript(sessionId: string): Promise<IpcResult<TranscriptEvent[]>>;
  };
  approvals: {
    respondApproval(sessionId: string, requestId: string, approve: boolean): Promise<IpcResult<boolean>>;
    respondClarify(sessionId: string, requestId: string, answer: string): Promise<IpcResult<boolean>>;
    /** Sends the sudo password to the gateway; empty string cancels. */
    respondSudo(sessionId: string, requestId: string, password: string): Promise<IpcResult<boolean>>;
    respondSecret(
      sessionId: string,
      requestId: string,
      value: string,
      cancelled: boolean,
    ): Promise<IpcResult<boolean>>;
  };
  telegram: {
    status(profileName: string): Promise<IpcResult<TelegramStatus>>;
    configure(input: {
      profileName: string;
      token?: string;
      mentionOnly?: boolean;
      allowedUsers?: string[];
      enabled?: boolean;
      removeToken?: boolean;
    }): Promise<IpcResult<TelegramStatus>>;
    test(profileName: string): Promise<IpcResult<{ ok: boolean; message: string }>>;
    gateway(profileName: string, action: 'start' | 'stop' | 'restart'): Promise<IpcResult<TelegramStatus>>;
  };
  logs: {
    get(profileName?: string): Promise<IpcResult<LogLine[]>>;
  };
  app: {
    version(): Promise<IpcResult<string>>;
  };
  /** Single validated event subscription; returns an unsubscribe function. */
  onEvent(listener: (envelope: PushEnvelope) => void): () => void;
}

declare global {
  interface Window {
    hermes?: HermesApi;
  }
}
