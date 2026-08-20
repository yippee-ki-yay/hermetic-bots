import { describe, it, expect } from 'vitest';
import { classifySshStderr } from '../../src/main/connection/host-key-policy';

describe('classifySshStderr', () => {
  it('detects changed host keys before unknown hosts', () => {
    const changed = `@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
Host key verification failed.`;
    expect(classifySshStderr(changed)).toBe('host-key-changed');
  });

  it('detects unknown hosts', () => {
    expect(classifySshStderr('Host key verification failed.')).toBe('unknown-host');
    expect(classifySshStderr('No matching host key type found.')).toBe('unknown-host');
  });

  it('detects auth failures', () => {
    expect(classifySshStderr('root@1.2.3.4: Permission denied (publickey).')).toBe('permission-denied');
  });

  it('detects forwarding policy rejections', () => {
    expect(classifySshStderr('channel 0: open failed: administratively prohibited')).toBe('forward-prohibited');
    expect(classifySshStderr('cannot listen to port: 9119')).toBe('forward-prohibited');
  });

  it('detects the local port race', () => {
    expect(classifySshStderr('bind [127.0.0.1]:50123: Address already in use')).toBe('port-in-use');
  });

  it('detects unreachable hosts', () => {
    expect(classifySshStderr('ssh: connect to host 1.2.3.4 port 22: Connection refused')).toBe('unreachable');
    expect(classifySshStderr('ssh: Could not resolve hostname nope: nodename nor servname provided')).toBe('unreachable');
  });

  it('falls back to other', () => {
    expect(classifySshStderr('something novel')).toBe('other');
  });
});
