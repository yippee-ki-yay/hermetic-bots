/**
 * Sanitized main-process logger with a bounded ring buffer. Diagnostics
 * include state transitions, endpoint names, statuses, and
 * correlation ids — never message bodies or secrets.
 */
import { randomUUID } from 'node:crypto';
import { redact } from './redaction';
import type { LogLine } from '@shared/contracts';

const MAX_LINES = 2000;
const buffer: LogLine[] = [];

export type LogLevel = LogLine['level'];

function push(level: LogLevel, scope: string, message: string): void {
  const line: LogLine = {
    at: new Date().toISOString(),
    level,
    scope,
    message: redact(message),
  };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[${line.level}] ${line.scope}: ${line.message}`);
  }
}

export const log = {
  debug: (scope: string, message: string) => push('debug', scope, message),
  info: (scope: string, message: string) => push('info', scope, message),
  warn: (scope: string, message: string) => push('warn', scope, message),
  error: (scope: string, message: string) => push('error', scope, message),
};

/** Store a raw diagnostic detail (redacted) and return its correlation id. */
export function recordDiagnostic(scope: string, detail: string): string {
  const id = randomUUID().slice(0, 8);
  push('error', scope, `[diag:${id}] ${detail}`);
  return id;
}

export function getLogLines(filter?: { level?: LogLevel }): LogLine[] {
  if (!filter?.level) return [...buffer];
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const min = order.indexOf(filter.level);
  return buffer.filter((l) => order.indexOf(l.level) >= min);
}

export function buildDiagnosticsReport(meta: Record<string, string | undefined>): string {
  const head = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const lines = buffer
    .slice(-400)
    .map((l) => `${l.at} [${l.level}] ${l.scope}: ${l.message}`)
    .join('\n');
  return redact(`${head}\n\n--- recent log ---\n${lines}\n`);
}
