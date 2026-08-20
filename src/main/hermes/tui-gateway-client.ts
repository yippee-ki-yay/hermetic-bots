/**
 * Hermes TUI gateway WebSocket client (spec §12.3–§12.4). JSON-RPC style
 * request/response with strict id correlation and exactly-once resolution,
 * plus a raw upstream event stream handed to the normalizer.
 *
 * The main process owns the single subscription (spec §9.3) so renderer
 * reloads never create duplicate event streams.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { log, recordDiagnostic } from '../logging/logger';
import { AppError, publicError } from '@shared/errors';

const RPC_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timer: NodeJS.Timeout;
  method: string;
  settled: boolean;
}

export interface GatewayClientEvents {
  open: () => void;
  close: () => void;
  event: (raw: Record<string, unknown>) => void;
}

export class TuiGatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private desired = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private knownMissingMethods = new Set<string>();

  constructor(private readonly getPort: () => number | null) {
    super();
  }

  override on<K extends keyof GatewayClientEvents>(event: K, listener: GatewayClientEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.desired = true;
    this.open();
  }

  disconnect(): void {
    this.desired = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teardown();
  }

  /** Reset and reconnect immediately (e.g. tunnel came back). */
  kick(): void {
    if (!this.desired) return;
    this.reconnectAttempt = 0;
    if (!this.connected) this.open();
  }

  private teardown(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    // Fail all pending calls exactly once so callers can mark delivery-unknown.
    for (const [id, p] of this.pending) {
      if (!p.settled) {
        p.settled = true;
        clearTimeout(p.timer);
        p.reject(
          new AppError(
            publicError('ws/disconnected', 'Connection lost', 'The live gateway connection dropped before the request was acknowledged.', true),
          ),
        );
      }
      this.pending.delete(id);
    }
  }

  private open(): void {
    const port = this.getPort();
    if (!port || this.ws) return;
    const url = `ws://127.0.0.1:${port}/api/ws`;
    log.info('ws', `connecting ${url}`);
    const ws = new WebSocket(url, { handshakeTimeout: 15_000 });
    this.ws = ws;

    ws.on('open', () => {
      log.info('ws', 'gateway connected');
      this.reconnectAttempt = 0;
      this.emit('open');
    });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        recordDiagnostic('ws', 'non-JSON frame received');
        return;
      }
      this.handleFrame(msg);
    });

    ws.on('error', (err) => {
      log.warn('ws', `gateway socket error: ${err.message}`);
    });

    ws.on('close', () => {
      log.info('ws', 'gateway closed');
      this.ws = null;
      this.teardown();
      this.emit('close');
      if (this.desired) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const delays = [500, 1000, 2000, 4000, 8000, 15_000];
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 15_000;
    this.reconnectAttempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private handleFrame(msg: Record<string, unknown>): void {
    const id = msg.id !== undefined && msg.id !== null ? String(msg.id) : null;
    if (id && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      if (p.settled) return; // exactly-once: ignore duplicate responses
      p.settled = true;
      clearTimeout(p.timer);
      this.pending.delete(id);
      if (msg.error) {
        const err = msg.error as { code?: number | string; message?: string };
        const code = String(err.code ?? '');
        const message = String(err.message ?? 'gateway error');
        if (code === '-32601' || /method.+not.+found/i.test(message)) {
          this.knownMissingMethods.add(p.method);
          p.reject(
            new AppError(
              publicError('ws/method-not-found', 'Not supported', `This Hermes version does not support ${p.method}.`, false),
            ),
          );
          return;
        }
        const diag = recordDiagnostic('ws', `rpc ${p.method} error ${code}: ${message.slice(0, 500)}`);
        p.reject(
          new AppError(publicError('hermes/http-error', 'Gateway error', message.slice(0, 300), false, diag)),
        );
        return;
      }
      p.resolve(msg.result);
      return;
    }
    // Not a response — treat as server-initiated event.
    this.emit('event', msg);
  }

  methodKnownMissing(method: string): boolean {
    return this.knownMissingMethods.has(method);
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connected || !this.ws) {
      return Promise.reject(
        new AppError(
          publicError('ws/disconnected', 'Not connected', 'The live gateway is not connected.', true),
        ),
      );
    }
    if (this.knownMissingMethods.has(method)) {
      return Promise.reject(
        new AppError(
          publicError('ws/method-not-found', 'Not supported', `This Hermes version does not support ${method}.`, false),
        ),
      );
    }
    const id = randomUUID();
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p && !p.settled) {
          p.settled = true;
          this.pending.delete(id);
          const diag = recordDiagnostic('ws', `rpc ${method} timed out after ${RPC_TIMEOUT_MS}ms`);
          reject(
            new AppError(
              publicError('ws/disconnected', 'Gateway timeout', 'The gateway did not answer in time.', true, diag),
            ),
          );
        }
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
        settled: false,
      });
      this.ws!.send(frame, (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p && !p.settled) {
            p.settled = true;
            clearTimeout(p.timer);
            this.pending.delete(id);
            reject(
              new AppError(
                publicError('ws/disconnected', 'Send failed', 'The request could not be written to the gateway.', true),
              ),
            );
          }
        }
      });
    });
  }
}
