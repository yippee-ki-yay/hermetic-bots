import { describe, it, expect, beforeEach } from 'vitest';
import { redact, redactDeep, registerSecret, clearRegisteredSecrets } from '../../src/main/logging/redaction';

describe('redact', () => {
  beforeEach(() => clearRegisteredSecrets());

  it('redacts Telegram bot tokens', () => {
    const line = 'configuring token 123456789:AAF0zW9dK3bL5xQyThisIsAFakeToken1234 for profile ops';
    expect(redact(line)).not.toContain('AAF0zW9dK3bL5xQy');
    expect(redact(line)).toContain('[REDACTED]');
  });

  it('redacts private key blocks', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nabcdef\n-----END OPENSSH PRIVATE KEY-----';
    expect(redact(`oops ${key} oops`)).toBe('oops [REDACTED] oops');
  });

  it('redacts authorization headers and bearer tokens', () => {
    expect(redact('authorization: Bearer abc123def456ghi789')).not.toContain('abc123def456');
  });

  it('redacts env-style secret assignments but keeps the name', () => {
    const out = redact('TELEGRAM_BOT_TOKEN=supersecretvalue123');
    expect(out).toContain('TELEGRAM_BOT_TOKEN');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('redacts registered exact values anywhere, including URL-encoded', () => {
    registerSecret('p@ss w0rd+special');
    expect(redact('value=p@ss w0rd+special')).not.toContain('p@ss w0rd+special');
    expect(redact(`q=${encodeURIComponent('p@ss w0rd+special')}`)).not.toContain('p%40ss');
  });

  it('leaves ordinary text alone', () => {
    const line = 'tunnel state starting-tunnel -> online (port 50123)';
    expect(redact(line)).toBe(line);
  });
});

describe('redactDeep', () => {
  it('redacts sensitive keys wholesale and strings recursively', () => {
    const out = redactDeep({
      token: 'abc',
      nested: { api_key: 'xyz', note: 'TELEGRAM_BOT_TOKEN=hidden123' },
      list: ['sk-ant-abcdefghijklmnop1234'],
    });
    expect(out.token).toBe('[REDACTED]');
    expect(out.nested.api_key).toBe('[REDACTED]');
    expect(out.nested.note).not.toContain('hidden123');
    expect(out.list[0]).toBe('[REDACTED]');
  });
});
