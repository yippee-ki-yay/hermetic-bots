/**
 * Normalizes raw Hermes gateway frames into the versioned TranscriptEvent
 * union the renderer consumes (spec §12.4). Raw payloads never cross the IPC
 * boundary; previews are redacted and bounded here.
 *
 * The mapping is deliberately tolerant: field names vary between Hermes
 * builds, so we look for the common shapes and fall back to a SystemEvent
 * diagnostic marker rather than dropping unknown frames silently.
 */
import { randomUUID } from 'node:crypto';
import { redact } from '../logging/redaction';
import type {
  TranscriptEvent,
  SystemEvent,
  ToolEvent,
  ApprovalEvent,
  ClarificationEvent,
  SudoRequestEvent,
  SecretRequestEvent,
} from '@shared/contracts';

const PREVIEW_LIMIT = 4000;

export interface NormalizerContext {
  profileName: string;
  sessionId: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function bounded(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const cut = s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}\n… (truncated)` : s;
  return redact(cut);
}

export type NormalizedFrame =
  | { kind: 'transcript'; event: TranscriptEvent }
  | { kind: 'delta'; sessionId: string; messageId: string; textDelta: string }
  | { kind: 'message-complete'; sessionId: string; messageId: string; fullText?: string }
  | { kind: 'ack'; sessionId: string; requestId: string }
  | { kind: 'run-state'; sessionId: string; state: 'thinking' | 'tool-running' | 'ready' | 'waiting-approval' }
  | { kind: 'expire'; sessionId: string; requestId: string; what: 'sudo' | 'secret' | 'approval' }
  | { kind: 'session-update'; sessionId: string; title?: string }
  | { kind: 'ignored' };

/** Extract the event name from the common envelope variants. */
export function frameEventName(raw: Record<string, unknown>): string | null {
  return str(raw.event) ?? str(raw.method) ?? str(raw.type) ?? null;
}

function frameParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params ?? raw.payload ?? raw.data;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : raw;
}

export function normalizeFrame(
  raw: Record<string, unknown>,
  ctx: (sessionId: string | undefined) => NormalizerContext | null,
): NormalizedFrame {
  let name = frameEventName(raw);
  if (!name) return { kind: 'ignored' };
  let p = frameParams(raw);
  // Hermes v0.20.x TUI gateway wraps events as JSON-RPC notifications:
  //   {method:"event", params:{type, session_id, payload:{...}}}
  // Unwrap to the inner type + payload, keeping session_id reachable.
  if (name === 'event') {
    const envelope = p;
    const innerName = str(envelope.type);
    if (!innerName) return { kind: 'ignored' };
    name = innerName;
    const payload =
      envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as Record<string, unknown>)
        : {};
    p = { ...payload, session_id: envelope.session_id };
  }
  const sessionId =
    str(p.session_id) ?? str(p.sessionId) ?? str(p.session) ?? str(raw.session_id) ?? undefined;
  const context = ctx(sessionId);
  if (!context) return { kind: 'ignored' };
  const { profileName } = context;
  const sid = context.sessionId;
  const at = new Date().toISOString();
  const base = { sessionId: sid, profileName, at };

  switch (true) {
    case name === 'gateway.ready':
      return { kind: 'ignored' };

    case name === 'message.delta' || name === 'assistant.delta': {
      const messageId = str(p.message_id) ?? str(p.messageId) ?? str(p.id) ?? 'stream';
      const delta = str(p.delta) ?? str(p.text) ?? str(p.content) ?? '';
      return { kind: 'delta', sessionId: sid, messageId, textDelta: delta };
    }

    case name === 'message.complete' || name === 'assistant.complete': {
      const messageId = str(p.message_id) ?? str(p.messageId) ?? str(p.id) ?? 'stream';
      return {
        kind: 'message-complete',
        sessionId: sid,
        messageId,
        fullText: str(p.text) ?? str(p.content),
      };
    }

    case name === 'prompt.ack' || name === 'prompt.accepted': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? '';
      return requestId ? { kind: 'ack', sessionId: sid, requestId } : { kind: 'ignored' };
    }

    case name === 'tool.start' || name === 'tool.generating': {
      const callId = str(p.tool_id) ?? str(p.call_id) ?? str(p.id) ?? randomUUID();
      const event: ToolEvent = {
        ...base,
        id: `tool-${callId}`,
        kind: 'tool',
        toolCallId: callId,
        toolName: str(p.name) ?? str(p.tool) ?? 'tool',
        status: 'running',
        inputPreview: bounded(p.args ?? p.input ?? p.preview),
      };
      return { kind: 'transcript', event };
    }

    case name === 'tool.progress': {
      const callId = str(p.tool_id) ?? str(p.call_id) ?? str(p.id) ?? randomUUID();
      const event: ToolEvent = {
        ...base,
        id: `tool-${callId}`,
        kind: 'tool',
        toolCallId: callId,
        toolName: str(p.name) ?? str(p.tool) ?? 'tool',
        status: 'running',
        outputPreview: bounded(p.output ?? p.progress ?? p.preview),
      };
      return { kind: 'transcript', event };
    }

    case name === 'tool.complete' || name === 'tool.result' || name === 'tool.error': {
      const failed =
        name === 'tool.error' || p.ok === false || str(p.status) === 'error' || p.error !== undefined;
      const callId = str(p.tool_id) ?? str(p.call_id) ?? str(p.id) ?? randomUUID();
      const event: ToolEvent = {
        ...base,
        id: `tool-${callId}`,
        kind: 'tool',
        toolCallId: callId,
        toolName: str(p.name) ?? str(p.tool) ?? 'tool',
        status: failed ? 'failed' : 'complete',
        elapsedMs: typeof p.elapsed_ms === 'number' ? p.elapsed_ms : undefined,
        outputPreview: bounded(p.result ?? p.output ?? p.preview),
        errorPreview: failed ? bounded(p.error) : undefined,
      };
      return { kind: 'transcript', event };
    }

    case name === 'approval.request': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      // Real v0.20.x payload carries tool/command detail plus a `choices`
      // list like ["once","session","always","deny"]; we surface once/deny.
      const summary =
        str(p.summary) ??
        str(p.description) ??
        str(p.action) ??
        (str(p.tool) ? `Run tool ${str(p.tool)}` : undefined) ??
        (str(p.name) ? `Run tool ${str(p.name)}` : undefined) ??
        str(p.command) ??
        'Approval requested';
      const detailSource =
        p.command ?? p.args ?? p.detail ??
        Object.fromEntries(
          Object.entries(p).filter(([k]) => !['request_id', 'session_id', 'choices'].includes(k)),
        );
      const event: ApprovalEvent = {
        ...base,
        id: `approval-${requestId}`,
        kind: 'approval',
        requestId,
        summary: redact(summary),
        detail: bounded(detailSource),
        risk: str(p.risk),
        timeoutAt: str(p.timeout_at) ?? str(p.expires_at),
        decision: 'pending',
      };
      return { kind: 'transcript', event };
    }

    case name === 'clarify.request': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      const rawOptions = Array.isArray(p.options) ? p.options : undefined;
      const event: ClarificationEvent = {
        ...base,
        id: `clarify-${requestId}`,
        kind: 'clarify',
        requestId,
        question: redact(str(p.question) ?? str(p.prompt) ?? 'The agent needs clarification'),
        options: rawOptions?.map((o) => redact(String(o))).slice(0, 12),
        decision: 'pending',
      };
      return { kind: 'transcript', event };
    }

    case name === 'sudo.request': {
      // Real semantic: the agent hit a sudo prompt and needs the password
      // (payload is empty apart from request_id); reply via sudo.respond
      // {request_id, password} — empty password cancels.
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      const event: SudoRequestEvent = {
        ...base,
        id: `sudo-${requestId}`,
        kind: 'sudo',
        requestId,
        commandSummary: redact(
          str(p.command) ?? str(p.summary) ?? 'The agent needs the sudo password to continue an elevated command.',
        ),
        decision: 'pending',
      };
      return { kind: 'transcript', event };
    }

    case name === 'secret.request': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      const event: SecretRequestEvent = {
        ...base,
        id: `secret-${requestId}`,
        kind: 'secret',
        requestId,
        prompt: redact(str(p.prompt) ?? str(p.name) ?? 'A secret value is required'),
        decision: 'pending',
      };
      return { kind: 'transcript', event };
    }

    case name === 'sudo.expire' || name === 'secret.expire' || name === 'approval.expire': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? '';
      const what = name.startsWith('sudo') ? 'sudo' : name.startsWith('secret') ? 'secret' : 'approval';
      return requestId
        ? { kind: 'expire', sessionId: sid, requestId, what }
        : { kind: 'ignored' };
    }

    case name === 'session.status' || name === 'status.update': {
      // v0.20.x payload: {kind, text}. Compaction gets a visible marker;
      // anything else means the agent is actively doing something.
      const s = str(p.kind) ?? str(p.state) ?? str(p.status) ?? '';
      if (/compact/i.test(s)) {
        const event: SystemEvent = {
          ...base,
          id: `sys-${randomUUID()}`,
          kind: 'system',
          systemType: 'compression',
          label: redact((str(p.text) ?? 'Context compressed').slice(0, 200)),
        };
        return { kind: 'transcript', event };
      }
      if (/tool/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'tool-running' };
      if (/approv|wait/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'waiting-approval' };
      if (/idle|ready|done|complete/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'ready' };
      return { kind: 'run-state', sessionId: sid, state: 'thinking' };
    }

    case name === 'session.updated' || name === 'session.title' || name === 'sessions.changed': {
      return { kind: 'session-update', sessionId: sid, title: str(p.title) };
    }

    // Reasoning/thinking streams are the model's private scratchpad; Hermes
    // surfaces the final answer via message.delta/complete, so these only
    // drive the run-state indicator rather than transcript content.
    case name === 'reasoning.delta' || name === 'thinking.delta' || name === 'message.start':
      return { kind: 'run-state', sessionId: sid, state: 'thinking' };

    case name === 'reasoning.available':
      return { kind: 'ignored' };

    case name === 'session.compressed': {
      const event: SystemEvent = {
        ...base,
        id: `sys-${randomUUID()}`,
        kind: 'system',
        systemType: 'compression',
        label: 'Context compressed',
      };
      return { kind: 'transcript', event };
    }

    case name === 'session.interrupted': {
      const event: SystemEvent = {
        ...base,
        id: `sys-${randomUUID()}`,
        kind: 'system',
        systemType: 'interrupt',
        label: 'Run interrupted',
      };
      return { kind: 'transcript', event };
    }

    case name === 'error' || name === 'session.error' || name === 'gateway.error': {
      const event: SystemEvent = {
        ...base,
        id: `sys-${randomUUID()}`,
        kind: 'system',
        systemType: 'error',
        label: redact((str(p.message) ?? 'Gateway error').slice(0, 300)),
      };
      return { kind: 'transcript', event };
    }

    default:
      return { kind: 'ignored' };
  }
}

/**
 * Hermes stores message timestamps as epoch-seconds, serialized as a string
 * (e.g. "1787247904.86"). Fall back to ISO fields for other builds.
 */
function historyTimestamp(m: Record<string, unknown>): string {
  const rawTs = m.timestamp ?? m.created_at ?? m.at;
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return new Date(rawTs * 1000).toISOString();
  }
  if (typeof rawTs === 'string') {
    const asNumber = Number(rawTs);
    if (Number.isFinite(asNumber) && asNumber > 0) return new Date(asNumber * 1000).toISOString();
    const parsed = Date.parse(rawTs);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Normalize a REST history message (GET /api/sessions/:id/messages) into
 * transcript events for initial render.
 */
export function normalizeHistoryMessage(
  raw: unknown,
  ctxBase: NormalizerContext,
  index: number,
): TranscriptEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const m = raw as Record<string, unknown>;
  const role = str(m.role) ?? str(m.type) ?? '';
  const at = historyTimestamp(m);
  const id = `hist-${str(m.id) ?? index}`;
  const base = { sessionId: ctxBase.sessionId, profileName: ctxBase.profileName, at };
  const content =
    str(m.content) ??
    str(m.text) ??
    (Array.isArray(m.content)
      ? (m.content as unknown[])
          .map((c) =>
            typeof c === 'string' ? c : str((c as Record<string, unknown>).text) ?? '',
          )
          .join('')
      : '');

  if (role === 'user' || role === 'human') {
    return [
      {
        ...base,
        id,
        kind: 'user',
        text: redact(content),
        requestId: str(m.request_id) ?? id,
        delivery: 'complete',
      },
    ];
  }
  if (role === 'assistant' || role === 'ai' || role === 'model') {
    return [
      {
        ...base,
        id,
        kind: 'assistant',
        text: redact(content),
        streaming: false,
        model: str(m.model),
      },
    ];
  }
  if (role === 'tool' || role === 'tool_result') {
    return [
      {
        ...base,
        id,
        kind: 'tool',
        toolCallId: str(m.tool_call_id) ?? str(m.call_id) ?? id,
        toolName: str(m.tool_name) ?? str(m.tool) ?? str(m.name) ?? 'tool',
        status: 'complete',
        outputPreview: bounded(content),
      },
    ];
  }
  if (role === 'system') {
    return [
      {
        ...base,
        id,
        kind: 'system',
        systemType: 'info',
        label: redact(content.slice(0, 300)),
      },
    ];
  }
  return [];
}
