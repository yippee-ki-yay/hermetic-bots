/**
 * SSH tunnel manager (spec §9.1, §11.4). The main process owns one OpenSSH
 * child process providing a local loopback forward to the remote dashboard.
 *
 * Invariants:
 *  - argv array, never a shell string;
 *  - local bind is 127.0.0.1 only;
 *  - system OpenSSH so agent/config/known_hosts behave normally;
 *  - no StrictHostKeyChecking=no, no auto-accepted changed keys;
 *  - child is stopped on disconnect/quit and restarted after unexpected exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { log, recordDiagnostic } from '../logging/logger';
import { redact } from '../logging/redaction';
import { classifySshStderr, type SshFailureKind } from './host-key-policy';
import type { ConnectionStatus } from '@shared/contracts';

export interface TunnelConfig {
  host: string;
  port: number;
  user: string;
  authMethod: 'agent' | 'key-file' | 'ssh-config-host';
  keyPath?: string;
  sshConfigHost?: string;
  remotePort: number;
}

export interface TunnelEvents {
  state: (state: ConnectionStatus) => void;
  ready: (localPort: number) => void;
  failure: (kind: SshFailureKind, diagnosticId: string) => void;
  exited: (unexpected: boolean) => void;
}

/** Backoff schedule in seconds (spec §9.1), jittered ±20%. */
export const BACKOFF_SCHEDULE_SEC = [1, 2, 4, 8, 15, 30];

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const idx = Math.min(attempt, BACKOFF_SCHEDULE_SEC.length - 1);
  const base = (BACKOFF_SCHEDULE_SEC[idx] ?? 30) * 1000;
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Pure argv builder — unit tested to guarantee loopback-only binding and
 * shell-free invocation.
 */
export function buildSshArgs(config: TunnelConfig, localPort: number): string[] {
  const args = [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'BatchMode=yes',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${config.remotePort}`,
  ];
  if (config.authMethod === 'ssh-config-host' && config.sshConfigHost) {
    args.push(config.sshConfigHost);
    return args;
  }
  if (config.port !== 22) args.push('-p', String(config.port));
  if (config.authMethod === 'key-file' && config.keyPath) args.push('-i', config.keyPath);
  args.push(`${config.user}@${config.host}`);
  return args;
}

/** Ask the OS for a free loopback port; race with ssh bind handled by retry. */
export function pickFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no address')));
      }
    });
  });
}

const READY_PROBE_INTERVAL_MS = 250;
const READY_TIMEOUT_MS = 30_000;

export class SshTunnelManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private config: TunnelConfig | null = null;
  private desired = false;
  private retryAttempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private stderrBuf = '';
  private startedAt = 0;
  public localPort: number | null = null;
  public status: ConnectionStatus = 'idle';
  public retryCount = 0;

  override on<K extends keyof TunnelEvents>(event: K, listener: TunnelEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof TunnelEvents>(
    event: K,
    ...args: Parameters<TunnelEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status !== s) {
      log.info('tunnel', `state ${this.status} -> ${s}`);
      this.status = s;
      this.emit('state', s);
    }
  }

  get uptimeSec(): number {
    return this.startedAt && this.status === 'online'
      ? Math.floor((Date.now() - this.startedAt) / 1000)
      : 0;
  }

  async start(config: TunnelConfig): Promise<void> {
    this.config = config;
    this.desired = true;
    this.retryAttempt = 0;
    this.retryCount = 0;
    await this.spawnOnce();
  }

  /** Called by the connection controller once Hermes answers /api/status. */
  markOnline(): void {
    this.retryAttempt = 0;
    this.setStatus('online');
  }

  markChecking(): void {
    this.setStatus('checking-hermes');
  }

  async stop(): Promise<void> {
    this.desired = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.killChild();
    this.localPort = null;
    this.setStatus('idle');
  }

  private killChild(): void {
    if (this.child) {
      this.child.removeAllListeners();
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
      this.child = null;
    }
  }

  private async spawnOnce(portRetries = 3): Promise<void> {
    if (!this.config || !this.desired) return;
    this.setStatus('starting-tunnel');
    this.stderrBuf = '';

    let localPort: number;
    try {
      localPort = await pickFreeLocalPort();
    } catch (err) {
      const diag = recordDiagnostic('tunnel', `port pick failed: ${(err as Error).message}`);
      this.emit('failure', 'other', diag);
      this.scheduleRetry();
      return;
    }

    const args = buildSshArgs(this.config, localPort);
    log.info('tunnel', `spawning ssh -L 127.0.0.1:${localPort} -> 127.0.0.1:${this.config.remotePort}`);
    const child = spawn('/usr/bin/ssh', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      // No shell, ever. Environment passes through so ssh-agent keeps working.
    });
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuf += chunk.toString('utf8');
      if (this.stderrBuf.length > 64_000) this.stderrBuf = this.stderrBuf.slice(-32_000);
    });

    child.on('error', (err) => {
      const diag = recordDiagnostic('tunnel', `spawn error: ${err.message}`);
      this.child = null;
      this.emit('failure', 'other', diag);
      this.scheduleRetry();
    });

    child.on('exit', (code, signal) => {
      const wasReady = this.localPort !== null;
      this.child = null;
      this.localPort = null;
      const kind = classifySshStderr(this.stderrBuf);
      const diag = recordDiagnostic(
        'tunnel',
        `ssh exited code=${code} signal=${signal} kind=${kind} stderr=${redact(this.stderrBuf.slice(-2000))}`,
      );

      if (!this.desired) return;

      if (kind === 'port-in-use' && portRetries > 0) {
        // Bind/spawn race (spec §16): retry immediately with another port.
        log.warn('tunnel', 'local port race; retrying with a new loopback port');
        void this.spawnOnce(portRetries - 1);
        return;
      }

      this.emit('failure', kind, diag);
      this.emit('exited', wasReady);

      // Fatal auth/trust failures wait for user action rather than retrying.
      if (kind === 'unknown-host' || kind === 'host-key-changed' || kind === 'permission-denied') {
        this.setStatus('offline');
        return;
      }
      this.setStatus(wasReady ? 'reconnecting' : 'reconnecting');
      this.scheduleRetry();
    });

    // Poll the local forward until it accepts a TCP connection.
    const ready = await this.waitForForward(localPort);
    if (!ready) {
      // exit handler will classify and schedule.
      return;
    }
    this.localPort = localPort;
    this.startedAt = Date.now();
    this.emit('ready', localPort);
  }

  private waitForForward(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      const tryOnce = (): void => {
        if (!this.child || !this.desired) return resolve(false);
        if (Date.now() > deadline) return resolve(false);
        const socket = new Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          socket.destroy();
          setTimeout(tryOnce, READY_PROBE_INTERVAL_MS);
        });
        socket.once('timeout', () => {
          socket.destroy();
          setTimeout(tryOnce, READY_PROBE_INTERVAL_MS);
        });
        socket.connect(port, '127.0.0.1');
      };
      tryOnce();
    });
  }

  private scheduleRetry(): void {
    if (!this.desired) return;
    const delay = backoffDelayMs(this.retryAttempt);
    this.retryAttempt += 1;
    this.retryCount += 1;
    if (this.retryAttempt > 12) {
      // Retry ceiling (spec §9.1): surface Offline; user can retry manually.
      this.setStatus('offline');
      return;
    }
    log.info('tunnel', `retry #${this.retryAttempt} in ${delay}ms`);
    this.setStatus('reconnecting');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.spawnOnce(), delay);
  }

  /** Immediate reconnect attempt, e.g. after wake or network change. */
  kick(): void {
    if (!this.desired) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryAttempt = 0;
    if (!this.child) void this.spawnOnce();
  }
}
