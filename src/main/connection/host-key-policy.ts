/**
 * Host-key handling (spec §6.1, §16). We never pass StrictHostKeyChecking=no
 * and never auto-accept changed keys. Unknown hosts surface an exact SHA256
 * fingerprint for explicit confirmation; accepting appends the scanned key to
 * ~/.ssh/known_hosts via normal OpenSSH tooling.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { log } from '../logging/logger';

const execFileP = promisify(execFile);

export type SshFailureKind =
  | 'unknown-host'
  | 'host-key-changed'
  | 'permission-denied'
  | 'forward-prohibited'
  | 'port-in-use'
  | 'unreachable'
  | 'other';

/** Classify OpenSSH stderr into known friendly categories (unit tested). */
export function classifySshStderr(stderr: string): SshFailureKind {
  const s = stderr.toLowerCase();
  if (s.includes('remote host identification has changed')) return 'host-key-changed';
  if (s.includes('host key verification failed') || s.includes('no matching host key')) {
    return 'unknown-host';
  }
  if (s.includes('permission denied')) return 'permission-denied';
  if (
    s.includes('administratively prohibited') ||
    s.includes('open failed') ||
    s.includes('forwarding is disabled') ||
    s.includes('cannot listen to port')
  ) {
    return 'forward-prohibited';
  }
  if (s.includes('address already in use')) return 'port-in-use';
  if (
    s.includes('connection refused') ||
    s.includes('connection timed out') ||
    s.includes('could not resolve hostname') ||
    s.includes('network is unreachable') ||
    s.includes('no route to host')
  ) {
    return 'unreachable';
  }
  return 'other';
}

export interface ScannedHostKey {
  keyType: string;
  fingerprint: string;
  /** Raw known_hosts line(s) held main-process side until the user confirms. */
  knownHostsLines: string;
}

/** Is the host already present in the user's known_hosts? */
export async function isHostKnown(host: string, port: number): Promise<boolean> {
  const target = port === 22 ? host : `[${host}]:${port}`;
  try {
    const { stdout } = await execFileP('/usr/bin/ssh-keygen', ['-F', target]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Fetch the server's key and compute the exact SHA256 fingerprint to show. */
export async function scanHostKey(host: string, port: number): Promise<ScannedHostKey | null> {
  try {
    const { stdout } = await execFileP(
      '/usr/bin/ssh-keyscan',
      ['-p', String(port), '-T', '10', host],
      { timeout: 15_000 },
    );
    const lines = stdout
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      // Prefer ed25519, then ecdsa, then rsa — mirrors modern OpenSSH ordering.
      .sort((a, b) => keyRank(a) - keyRank(b));
    const first = lines[0];
    if (!first) return null;

    const tmp = join(tmpdir(), `hermesbots-hostkey-${randomUUID()}`);
    await writeFile(tmp, `${first}\n`, { mode: 0o600 });
    const { stdout: fpOut } = await execFileP('/usr/bin/ssh-keygen', ['-lf', tmp]);
    // Format: "256 SHA256:xxxx host (ED25519)"
    const parts = fpOut.trim().split(/\s+/);
    const fingerprint = parts[1] ?? '';
    const keyType = (parts[parts.length - 1] ?? '').replace(/[()]/g, '');
    return { keyType, fingerprint, knownHostsLines: lines.join('\n') };
  } catch (err) {
    log.warn('host-key', `ssh-keyscan failed: ${(err as Error).message}`);
    return null;
  }
}

function keyRank(line: string): number {
  if (line.includes('ssh-ed25519')) return 0;
  if (line.includes('ecdsa')) return 1;
  if (line.includes('ssh-rsa')) return 2;
  return 3;
}

/** After explicit user confirmation only: record the scanned key. */
export async function trustHostKey(scanned: ScannedHostKey): Promise<void> {
  const sshDir = join(homedir(), '.ssh');
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  const knownHosts = join(sshDir, 'known_hosts');
  let existing = '';
  try {
    existing = await readFile(knownHosts, 'utf8');
  } catch {
    /* file may not exist yet */
  }
  const toAdd = scanned.knownHostsLines
    .split('\n')
    .filter((l) => l.trim() && !existing.includes(l.trim()))
    .join('\n');
  if (toAdd) await appendFile(knownHosts, `${toAdd}\n`, { mode: 0o600 });
  log.info('host-key', `host key trusted (${scanned.fingerprint})`);
}
