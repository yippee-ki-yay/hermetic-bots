/**
 * Renderer-safe domain contracts. Nothing in this file may carry
 * secret material: no tokens, no key paths, no env values, no raw SSH argv.
 */
import type { PublicError } from './errors';

// ---------------------------------------------------------------------------
// Connection

export type ConnectionStatus =
  | 'idle'
  | 'resolving'
  | 'awaiting-trust'
  | 'starting-tunnel'
  | 'checking-hermes'
  | 'online'
  | 'reconnecting'
  | 'offline';

export type AuthMethod = 'agent' | 'key-file' | 'ssh-config-host';

export interface ConnectionConfigPublic {
  label: string;
  host: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  /** Only set for authMethod key-file; a path is metadata, never key contents. */
  keyPathLabel?: string;
  /** Only set for authMethod ssh-config-host. */
  sshConfigHost?: string;
  remotePort: number;
}

export interface ConnectionSummary {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  status: ConnectionStatus;
  hermesVersion?: string;
  latencyMs?: number;
  /** Local loopback port the tunnel is bound to; useful for diagnostics only. */
  localPort?: number;
  tunnelUptimeSec?: number;
  retryCount?: number;
  hostFingerprint?: string;
  lastCheckedAt?: string;
  lastError?: PublicError;
}

export interface HostTrustPrompt {
  host: string;
  port: number;
  /** e.g. "SHA256:AbCd..." — exact fingerprint the user must verify. */
  fingerprint: string;
  keyType: string;
}

// ---------------------------------------------------------------------------
// Capabilities

export interface Capabilities {
  hermesVersion?: string;
  profilesCreate: boolean;
  profilesSoul: boolean;
  profilesRename: boolean;
  profilesDelete: boolean;
  chatStreaming: boolean;
  sessionBranch: boolean;
  sessionCompress: boolean;
  messagingTelegram: boolean;
  gatewayControl: boolean;
  cronManage: boolean;
  logs: boolean;
  usage: boolean;
  mcp: boolean;
  skills: boolean;
}

// ---------------------------------------------------------------------------
// Bots / profiles

export interface OrbDefinition {
  paletteId: string;
  seed: string;
  /** Jar shape, eye style, and pose; derived from the seed when unset. */
  jar?: 'bell' | 'cylinder' | 'flask' | 'hex' | 'bulb';
  eyes?: 'stalks' | 'cyclops' | 'sleepy' | 'wide';
  pose?: 'rest' | 'wave';
  /** Retained so metadata written before the crab avatars still validates. */
  ringCount?: 1 | 2 | 3;
  tickPattern?: number;
}

export type BotRunState = 'idle' | 'running' | 'attention' | 'error';
export type GatewayState = 'disabled' | 'starting' | 'online' | 'degraded' | 'offline';

export interface BotSummary {
  profileName: string;
  displayName: string;
  role?: string;
  description?: string;
  orb: OrbDefinition;
  /** User-chosen picture as a local `data:` URI; falls back to the orb mark. */
  avatarDataUri?: string;
  provider?: string;
  model?: string;
  runState: BotRunState;
  gatewayState: GatewayState;
  unreadCount: number;
  workingDir?: string;
}

// ---------------------------------------------------------------------------
// Threads / sessions

export type ThreadState = 'idle' | 'active' | 'attention' | 'archived' | 'error';

export interface ThreadSummary {
  id: string;
  profileName: string;
  title: string;
  preview?: string;
  updatedAt: string;
  state: ThreadState;
  unread: boolean;
}

// ---------------------------------------------------------------------------
// Transcript events (normalized union)

export type PromptDeliveryState =
  | 'draft'
  | 'submitting'
  | 'acknowledged'
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'failed'
  | 'delivery-unknown';

interface TranscriptEventBase {
  /** Stable id for React keys and scroll anchoring. */
  id: string;
  sessionId: string;
  profileName: string;
  at: string;
}

export interface UserMessageEvent extends TranscriptEventBase {
  kind: 'user';
  text: string;
  requestId: string;
  delivery: PromptDeliveryState;
  /** True when the prompt was sent as steering/queued during an active run. */
  steered?: boolean;
}

export interface AssistantMessageEvent extends TranscriptEventBase {
  kind: 'assistant';
  text: string;
  streaming: boolean;
  model?: string;
}

export type ToolStatus = 'running' | 'complete' | 'failed';

export interface ToolEvent extends TranscriptEventBase {
  kind: 'tool';
  toolCallId: string;
  toolName: string;
  status: ToolStatus;
  elapsedMs?: number;
  /** Redacted, bounded input/output previews. */
  inputPreview?: string;
  outputPreview?: string;
  errorPreview?: string;
}

export type DecisionState = 'pending' | 'approved' | 'denied' | 'expired' | 'answered';

export interface ApprovalEvent extends TranscriptEventBase {
  kind: 'approval';
  requestId: string;
  summary: string;
  detail?: string;
  risk?: string;
  timeoutAt?: string;
  decision: DecisionState;
}

export interface ClarificationEvent extends TranscriptEventBase {
  kind: 'clarify';
  requestId: string;
  question: string;
  options?: string[];
  decision: DecisionState;
  answer?: string;
}

export interface SudoRequestEvent extends TranscriptEventBase {
  kind: 'sudo';
  requestId: string;
  commandSummary: string;
  decision: DecisionState;
}

export interface SecretRequestEvent extends TranscriptEventBase {
  kind: 'secret';
  requestId: string;
  prompt: string;
  decision: DecisionState;
}

export type SystemEventType =
  | 'reconnect'
  | 'compression'
  | 'branch'
  | 'interrupt'
  | 'model-change'
  | 'session-created'
  | 'error'
  | 'info';

export interface SystemEvent extends TranscriptEventBase {
  kind: 'system';
  systemType: SystemEventType;
  label: string;
}

export type TranscriptEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolEvent
  | ApprovalEvent
  | ClarificationEvent
  | SecretRequestEvent
  | SudoRequestEvent
  | SystemEvent;

export type RunState = 'ready' | 'thinking' | 'tool-running' | 'waiting-approval' | 'disconnected';

// ---------------------------------------------------------------------------
// Messaging / gateway

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  state: GatewayState;
  mentionOnly?: boolean;
  allowedUsers?: string[];
  lastCheckedAt?: string;
  /** Sanitized recent errors — never token material. */
  recentErrors?: string[];
}

// ---------------------------------------------------------------------------
// Profile configuration (renderer-safe views)

export interface ModelOption {
  provider: string;
  model: string;
  label?: string;
}

/** One provider Hermes can serve, with the models it exposes. */
export interface ProviderOption {
  slug: string;
  name: string;
  models: string[];
  /** False when the server has no usable credentials for it. */
  authenticated: boolean;
  isCurrent: boolean;
}

export interface ModelOptions {
  providers: ProviderOption[];
  currentProvider?: string;
  currentModel?: string;
}

export interface ToolsetInfo {
  id: string;
  name: string;
  description?: string;
  risk: 'read' | 'mutate' | 'terminal' | 'network' | 'unknown';
  enabled: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

export interface McpServerInfo {
  id: string;
  name: string;
  status?: string;
}

export interface RoutineInfo {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunAt?: string;
}

export interface ProfileDetails {
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  workingDir?: string;
  approvalMode?: string;
  path?: string;
}

/** A file staged for the next prompt. Server paths stay in the main process. */
export interface AttachmentSummary {
  id: string;
  name: string;
  kind: 'image' | 'file';
  sizeBytes: number;
}

/** One entry in the bundled persona library (metadata only). */
export interface PersonaSummary {
  id: string;
  name: string;
  division: string;
  description: string;
  vibe: string;
}

export interface CreateBotInput {
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
}

export interface CreateBotStepResult {
  step: 'profile' | 'soul' | 'description' | 'model';
  ok: boolean;
  error?: PublicError;
}

export interface CreateBotResult {
  ok: boolean;
  profileName?: string;
  steps: CreateBotStepResult[];
}

// ---------------------------------------------------------------------------
// Logs / diagnostics

export interface LogLine {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
}

// ---------------------------------------------------------------------------
// App preferences

export interface AppPreferences {
  enterToSend: boolean;
  notifyApprovals: boolean;
  notifyCompletedRuns: boolean;
  notifyConnectionFailures: boolean;
  reconnectOnLaunch: boolean;
  theme: 'system' | 'dark';
  /** Thread Deck visibility; collapsed by default so chat gets full width. */
  showThreadDeck: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  enterToSend: true,
  notifyApprovals: true,
  notifyCompletedRuns: true,
  notifyConnectionFailures: true,
  reconnectOnLaunch: true,
  theme: 'dark',
  showThreadDeck: false,
};

// ---------------------------------------------------------------------------
// Push events main → renderer (single envelope channel)

export type PushEvent =
  | { type: 'connection.state'; connection: ConnectionSummary }
  | { type: 'connection.trust-prompt'; prompt: HostTrustPrompt }
  | { type: 'capabilities'; capabilities: Capabilities }
  | { type: 'bots.updated'; bots: BotSummary[] }
  | { type: 'bot.updated'; bot: BotSummary }
  | { type: 'threads.updated'; profileName: string; threads: ThreadSummary[] }
  | { type: 'thread.updated'; thread: ThreadSummary }
  | { type: 'transcript.event'; event: TranscriptEvent }
  | { type: 'transcript.delta'; sessionId: string; eventId: string; textDelta: string }
  | { type: 'run.state'; sessionId: string; runState: RunState }
  | { type: 'prompt.delivery'; sessionId: string; requestId: string; delivery: PromptDeliveryState }
  | { type: 'gateway.status'; profileName: string; status: TelegramStatus }
  | { type: 'session.created'; provisionalId: string; thread: ThreadSummary }
  | { type: 'attachments.updated'; sessionId: string; attachments: AttachmentSummary[] };

export interface PushEnvelope {
  v: 1;
  event: PushEvent;
}

// ---------------------------------------------------------------------------
// Initial connection defaults — editable starting points, not policy

export const CONNECTION_DEFAULTS = {
  label: 'Hermes VPS',
  /** Deliberately blank: the server is the operator's to supply on first run. */
  host: '',
  port: 22,
  user: 'root',
  remoteDashboardHost: '127.0.0.1',
  remoteDashboardPort: 9119,
  expectedHermesVersion: '0.20.4',
} as const;
