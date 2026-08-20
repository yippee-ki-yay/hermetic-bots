/**
 * Renderer-safe error model. Anything crossing the IPC boundary is a
 * PublicError: no stack traces, no raw stderr, no secrets. The main process
 * keeps the raw diagnostic under `diagnosticId` in its sanitized ring buffer.
 */

export type PublicErrorCode =
  | 'ssh/unknown-host'
  | 'ssh/host-key-changed'
  | 'ssh/permission-denied'
  | 'ssh/forward-prohibited'
  | 'ssh/unreachable'
  | 'ssh/exited'
  | 'tunnel/port-race'
  | 'hermes/unavailable'
  | 'hermes/schema-mismatch'
  | 'hermes/http-error'
  | 'ws/disconnected'
  | 'ws/method-not-found'
  | 'telegram/token-invalid'
  | 'gateway/restart-failed'
  | 'profile/partial-create'
  | 'approval/expired'
  | 'ipc/invalid-request'
  | 'app/internal';

export interface PublicError {
  code: PublicErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  diagnosticId?: string;
}

export class AppError extends Error {
  constructor(public readonly publicError: PublicError) {
    super(publicError.message);
    this.name = 'AppError';
  }
}

export function publicError(
  code: PublicErrorCode,
  title: string,
  message: string,
  retryable = false,
  diagnosticId?: string,
): PublicError {
  return { code, title, message, retryable, diagnosticId };
}

export function toPublicError(err: unknown, fallbackTitle = 'Something went wrong'): PublicError {
  if (err instanceof AppError) return err.publicError;
  if (err && typeof err === 'object' && 'code' in err && 'title' in err && 'retryable' in err) {
    return err as PublicError;
  }
  return publicError('app/internal', fallbackTitle, 'An unexpected internal error occurred.', true);
}
