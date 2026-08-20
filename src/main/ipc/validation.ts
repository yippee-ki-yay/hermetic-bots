/**
 * Typed, allowlisted IPC (spec §11.2). Every invoke handler validates its
 * payload with zod before executing, and every thrown error is converted to a
 * PublicError so raw internals never reach the renderer.
 */
import { ipcMain } from 'electron';
import type { z } from 'zod';
import { AppError, toPublicError, publicError } from '@shared/errors';
import { log, recordDiagnostic } from '../logging/logger';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ReturnType<typeof toPublicError> };

const registered = new Set<string>();

export function handle<S extends z.ZodType, R>(
  channel: string,
  schema: S | null,
  fn: (input: z.infer<S>) => Promise<R> | R,
): void {
  if (registered.has(channel)) throw new Error(`duplicate IPC channel ${channel}`);
  registered.add(channel);
  ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<R>> => {
    try {
      let input: z.infer<S> | undefined = undefined;
      if (schema) {
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          const diag = recordDiagnostic(
            'ipc',
            `${channel} invalid payload: ${parsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
          );
          return {
            ok: false,
            error: publicError('ipc/invalid-request', 'Invalid request', 'The request was rejected by validation.', false, diag),
          };
        }
        input = parsed.data;
      }
      const data = await fn(input as z.infer<S>);
      return { ok: true, data };
    } catch (err) {
      if (!(err instanceof AppError)) {
        recordDiagnostic('ipc', `${channel} unexpected error: ${(err as Error)?.message ?? String(err)}`);
      } else {
        log.warn('ipc', `${channel} failed: ${err.publicError.code}`);
      }
      return { ok: false, error: toPublicError(err) };
    }
  });
}
