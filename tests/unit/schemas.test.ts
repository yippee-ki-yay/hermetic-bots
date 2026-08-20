import { describe, it, expect } from 'vitest';
import {
  profileNameSchema,
  connectConfigSchema,
  submitPromptSchema,
  telegramConfigSchema,
} from '../../src/shared/schemas';

describe('IPC schemas', () => {
  it('accepts valid profile names and rejects traversal/injection shapes', () => {
    expect(profileNameSchema.safeParse('researcher').success).toBe(true);
    expect(profileNameSchema.safeParse('pnl-analyst_2.0').success).toBe(true);
    expect(profileNameSchema.safeParse('../etc').success).toBe(false);
    expect(profileNameSchema.safeParse('a b').success).toBe(false);
    expect(profileNameSchema.safeParse('-leading').success).toBe(false);
    expect(profileNameSchema.safeParse('').success).toBe(false);
  });

  it('validates connect config bounds', () => {
    const good = connectConfigSchema.safeParse({
      label: 'VPS',
      host: '1.2.3.4',
      port: 22,
      user: 'root',
      authMethod: 'agent',
      remotePort: 9119,
    });
    expect(good.success).toBe(true);
    expect(connectConfigSchema.safeParse({ ...good.data, port: 0 }).success).toBe(false);
    expect(connectConfigSchema.safeParse({ ...good.data, port: 70000 }).success).toBe(false);
  });

  it('requires a UUID request id on prompt submission', () => {
    const base = {
      profileName: 'ops',
      sessionId: 's1',
      text: 'hello',
      mode: 'normal',
    };
    expect(submitPromptSchema.safeParse({ ...base, requestId: 'not-a-uuid' }).success).toBe(false);
    expect(
      submitPromptSchema.safeParse({ ...base, requestId: '4b4d1a5e-9e0f-4c9d-8f37-2b1a9a9a9a9a' }).success,
    ).toBe(true);
  });

  it('bounds telegram token length', () => {
    expect(telegramConfigSchema.safeParse({ profileName: 'ops', token: 'short' }).success).toBe(false);
    expect(
      telegramConfigSchema.safeParse({ profileName: 'ops', token: '123456789:AAFvalidlookingtoken12345678901234' }).success,
    ).toBe(true);
  });
});
