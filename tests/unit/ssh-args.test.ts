import { describe, it, expect } from 'vitest';
import {
  buildSshArgs,
  backoffDelayMs,
  BACKOFF_SCHEDULE_SEC,
  type TunnelConfig,
} from '../../src/main/connection/ssh-tunnel-manager';

const base: TunnelConfig = {
  host: '203.0.113.10',
  port: 22,
  user: 'root',
  authMethod: 'agent',
  remotePort: 9119,
};

describe('buildSshArgs', () => {
  it('always binds the local forward to 127.0.0.1 only', () => {
    const args = buildSshArgs(base, 50123);
    const forward = args[args.indexOf('-L') + 1];
    expect(forward).toBe('127.0.0.1:50123:127.0.0.1:9119');
    expect(forward).not.toContain('0.0.0.0');
    expect(forward).not.toContain('::');
  });

  it('never weakens host key checking', () => {
    const args = buildSshArgs(base, 50123).join(' ');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).not.toContain('StrictHostKeyChecking=no');
    expect(args).not.toContain('UserKnownHostsFile=/dev/null');
  });

  it('uses -N with keepalives and ExitOnForwardFailure', () => {
    const args = buildSshArgs(base, 50123);
    expect(args).toContain('-N');
    expect(args.join(' ')).toContain('ExitOnForwardFailure=yes');
    expect(args.join(' ')).toContain('ServerAliveInterval=30');
  });

  it('is an argv array with no shell metacharacters concatenated', () => {
    const evil: TunnelConfig = { ...base, host: 'example.com; rm -rf /', user: 'root$(x)' };
    const args = buildSshArgs(evil, 50123);
    // Values stay contained in single argv entries; nothing is joined into a shell string.
    expect(args[args.length - 1]).toBe('root$(x)@example.com; rm -rf /');
    expect(args.every((a) => typeof a === 'string')).toBe(true);
  });

  it('adds -p and -i only when explicitly configured', () => {
    expect(buildSshArgs(base, 1)).not.toContain('-p');
    expect(buildSshArgs(base, 1)).not.toContain('-i');
    const custom = buildSshArgs({ ...base, port: 2222, authMethod: 'key-file', keyPath: '/k' }, 1);
    expect(custom).toContain('-p');
    expect(custom[custom.indexOf('-p') + 1]).toBe('2222');
    expect(custom[custom.indexOf('-i') + 1]).toBe('/k');
  });

  it('uses the ssh config alias verbatim when configured', () => {
    const args = buildSshArgs({ ...base, authMethod: 'ssh-config-host', sshConfigHost: 'hermes-vps' }, 1);
    expect(args[args.length - 1]).toBe('hermes-vps');
    expect(args.join(' ')).not.toContain('root@');
  });
});

describe('backoffDelayMs', () => {
  it('follows the 1,2,4,8,15,30s schedule with ±20% jitter', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const idx = Math.min(attempt, BACKOFF_SCHEDULE_SEC.length - 1);
      const baseMs = BACKOFF_SCHEDULE_SEC[idx]! * 1000;
      const low = backoffDelayMs(attempt, () => 0);
      const high = backoffDelayMs(attempt, () => 1);
      expect(low).toBe(Math.round(baseMs * 0.8));
      expect(high).toBe(Math.round(baseMs * 1.2));
    }
  });

  it('caps at the 30s ceiling', () => {
    expect(backoffDelayMs(100, () => 0.5)).toBe(30_000);
  });
});
