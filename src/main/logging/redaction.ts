/**
 * Secret redaction (spec §15.3). Two layers:
 *  1. Pattern redaction for well-known secret shapes.
 *  2. Exact-value redaction for secrets the app has actually handled this
 *     session (registered at the moment they pass through the main process).
 *
 * Everything that reaches the log ring buffer, diagnostics report, renderer
 * previews, or crash data must pass through `redact()` first.
 */

const PATTERNS: { name: string; re: RegExp }[] = [
  // Telegram bot tokens: digits, colon, 30+ chars of base64-ish
  { name: 'telegram-token', re: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  // OpenSSH private key blocks
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  // Bearer / Authorization headers
  { name: 'auth-header', re: /\b(authorization|proxy-authorization)\s*[:=]\s*\S+/gi },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g },
  // Common API key shapes
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // Generic key=value assignments for sensitive names
  {
    name: 'env-secret',
    re: /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*[^\s"']+/g,
  },
];

const registered: Set<string> = new Set();

/** Register an exact secret value seen in transit so it can never be logged. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 4) registered.add(value);
}

export function clearRegisteredSecrets(): void {
  registered.clear();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(input: string): string {
  let out = input;
  for (const { re } of PATTERNS) {
    out = out.replace(re, (m) => {
      // Preserve env var name for diagnosability, drop the value.
      const eq = m.match(/^([A-Z0-9_]+\s*[=:]\s*)/);
      return eq ? `${eq[1]}[REDACTED]` : '[REDACTED]';
    });
  }
  for (const secret of registered) {
    out = out.split(secret).join('[REDACTED]');
    try {
      out = out.replace(new RegExp(escapeRegExp(encodeURIComponent(secret)), 'g'), '[REDACTED]');
    } catch {
      /* value not encodable — plain replacement above already ran */
    }
  }
  return out;
}

/** Redact every string field of an arbitrary JSON-ish value, bounded depth. */
export function redactDeep<T>(value: T, depth = 6): T {
  if (depth <= 0) return '[TRUNCATED]' as unknown as T;
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth - 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|passwd|api[-_]?key|private[-_]?key|authorization/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactDeep(v, depth - 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}
