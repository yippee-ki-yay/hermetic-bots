import { describe, it, expect } from 'vitest';
import { normalizeFrame, normalizeHistoryMessage } from '../../src/main/hermes/event-normalizer';

const ctx = (): { profileName: string; sessionId: string } => ({
  profileName: 'researcher',
  sessionId: 's1',
});

describe('normalizeFrame', () => {
  it('normalizes message deltas', () => {
    const out = normalizeFrame(
      { event: 'message.delta', params: { session_id: 's1', message_id: 'm1', delta: 'Hel' } },
      () => ctx(),
    );
    expect(out).toEqual({ kind: 'delta', sessionId: 's1', messageId: 'm1', textDelta: 'Hel' });
  });

  it('normalizes tool lifecycle with bounded, redacted previews', () => {
    const big = 'x'.repeat(10_000);
    const out = normalizeFrame(
      {
        event: 'tool.complete',
        params: { session_id: 's1', call_id: 'c1', tool: 'terminal.run', output: big },
      },
      () => ctx(),
    );
    expect(out.kind).toBe('transcript');
    if (out.kind === 'transcript' && out.event.kind === 'tool') {
      expect(out.event.status).toBe('complete');
      expect((out.event.outputPreview ?? '').length).toBeLessThan(5000);
      expect(out.event.outputPreview).toContain('truncated');
    }
  });

  it('marks tool.error frames failed', () => {
    const out = normalizeFrame(
      { event: 'tool.error', params: { session_id: 's1', call_id: 'c1', tool: 't', error: 'boom' } },
      () => ctx(),
    );
    expect(out.kind === 'transcript' && out.event.kind === 'tool' && out.event.status).toBe('failed');
  });

  it('redacts secrets inside approval summaries', () => {
    const out = normalizeFrame(
      {
        event: 'approval.request',
        params: {
          session_id: 's1',
          request_id: 'r1',
          summary: 'run with TELEGRAM_BOT_TOKEN=verysecret999',
        },
      },
      () => ctx(),
    );
    expect(out.kind).toBe('transcript');
    if (out.kind === 'transcript' && out.event.kind === 'approval') {
      expect(out.event.summary).not.toContain('verysecret999');
      expect(out.event.decision).toBe('pending');
    }
  });

  it('normalizes secret/sudo expiry to expire frames', () => {
    const out = normalizeFrame(
      { event: 'sudo.expire', params: { session_id: 's1', request_id: 'r9' } },
      () => ctx(),
    );
    expect(out).toEqual({ kind: 'expire', sessionId: 's1', requestId: 'r9', what: 'sudo' });
  });

  it('ignores unknown frames and frames without resolvable context', () => {
    expect(normalizeFrame({ event: 'totally.unknown', params: {} }, () => ctx()).kind).toBe('ignored');
    expect(normalizeFrame({ event: 'message.delta', params: {} }, () => null).kind).toBe('ignored');
  });

  it('maps prompt acks', () => {
    const out = normalizeFrame(
      { event: 'prompt.ack', params: { session_id: 's1', request_id: 'req-1' } },
      () => ctx(),
    );
    expect(out).toEqual({ kind: 'ack', sessionId: 's1', requestId: 'req-1' });
  });
});

describe('normalizeHistoryMessage', () => {
  it('maps user/assistant/tool roles', () => {
    const user = normalizeHistoryMessage({ role: 'user', content: 'hi', id: 1 }, ctx(), 0);
    expect(user[0]?.kind).toBe('user');
    const assistant = normalizeHistoryMessage({ role: 'assistant', content: 'hello', id: 2 }, ctx(), 1);
    expect(assistant[0]?.kind).toBe('assistant');
    const tool = normalizeHistoryMessage({ role: 'tool', name: 'web.search', content: 'r', id: 3 }, ctx(), 2);
    expect(tool[0]?.kind).toBe('tool');
  });

  it('joins structured content arrays', () => {
    const out = normalizeHistoryMessage(
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], id: 4 },
      ctx(),
      0,
    );
    expect(out[0]?.kind === 'assistant' && out[0].text).toBe('ab');
  });

  it('drops unknown roles instead of crashing', () => {
    expect(normalizeHistoryMessage({ role: 'weird' }, ctx(), 0)).toEqual([]);
    expect(normalizeHistoryMessage(null, ctx(), 0)).toEqual([]);
  });
});
