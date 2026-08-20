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
  const name = frameEventName(raw);
  if (!name) return { kind: 'ignored' };
  const p = frameParams(raw);
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

    case name === 'tool.start': {
      const event: ToolEvent = {
        ...base,
        id: `tool-${str(p.call_id) ?? str(p.id) ?? randomUUID()}`,
        kind: 'tool',
        toolCallId: str(p.call_id) ?? str(p.id) ?? randomUUID(),
        toolName: str(p.tool) ?? str(p.name) ?? 'tool',
        status: 'running',
        inputPreview: bounded(p.input ?? p.args),
      };
      return { kind: 'transcript', event };
    }

    case name === 'tool.progress': {
      const event: ToolEvent = {
        ...base,
        id: `tool-${str(p.call_id) ?? str(p.id) ?? randomUUID()}`,
        kind: 'tool',
        toolCallId: str(p.call_id) ?? str(p.id) ?? randomUUID(),
        toolName: str(p.tool) ?? str(p.name) ?? 'tool',
        status: 'running',
        outputPreview: bounded(p.output ?? p.progress),
      };
      return { kind: 'transcript', event };
    }

    case name === 'tool.complete' || name === 'tool.result' || name === 'tool.error': {
      const failed =
        name === 'tool.error' || p.ok === false || str(p.status) === 'error' || p.error !== undefined;
      const event: ToolEvent = {
        ...base,
        id: `tool-${str(p.call_id) ?? str(p.id) ?? randomUUID()}`,
        kind: 'tool',
        toolCallId: str(p.call_id) ?? str(p.id) ?? randomUUID(),
        toolName: str(p.tool) ?? str(p.name) ?? 'tool',
        status: failed ? 'failed' : 'complete',
        elapsedMs: typeof p.elapsed_ms === 'number' ? p.elapsed_ms : undefined,
        outputPreview: bounded(p.output ?? p.result),
        errorPreview: failed ? bounded(p.error) : undefined,
      };
      return { kind: 'transcript', event };
    }

    case name === 'approval.request': {
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      const event: ApprovalEvent = {
        ...base,
        id: `approval-${requestId}`,
        kind: 'approval',
        requestId,
        summary: redact(str(p.summary) ?? str(p.action) ?? 'Approval requested'),
        detail: bounded(p.detail ?? p.payload ?? p.command),
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
      const requestId = str(p.request_id) ?? str(p.requestId) ?? str(p.id) ?? randomUUID();
      const event: SudoRequestEvent = {
        ...base,
        id: `sudo-${requestId}`,
        kind: 'sudo',
        requestId,
        commandSummary: redact(str(p.command) ?? str(p.summary) ?? 'Elevated command requested'),
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
      const s = str(p.state) ?? str(p.status) ?? '';
      if (/tool/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'tool-running' };
      if (/think|run|generat/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'thinking' };
      if (/approv|wait/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'waiting-approval' };
      if (/idle|ready|done|complete/i.test(s)) return { kind: 'run-state', sessionId: sid, state: 'ready' };
      return { kind: 'ignored' };
    }

    case name === 'session.updated' || name === 'session.title': {
      return { kind: 'session-update', sessionId: sid, title: str(p.title) };
    }

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
  const at = str(m.created_at) ?? str(m.at) ?? new Date().toISOString();
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
        toolCallId: str(m.call_id) ?? id,
        toolName: str(m.tool) ?? str(m.name) ?? 'tool',
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
