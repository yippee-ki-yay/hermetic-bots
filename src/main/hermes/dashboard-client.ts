/**
 * Hermes Dashboard REST client (spec §12.1–§12.2). All requests go to the
 * loopback tunnel endpoint only. Responses are treated as untrusted input:
 * validated leniently, logged sanitized, and normalized before the renderer
 * ever sees them.
 */
import { z } from 'zod';
import { AppError, publicError } from '@shared/errors';
import { log, recordDiagnostic } from '../logging/logger';
import { redact, registerSecret } from '../logging/redaction';

const TIMEOUT_MS = 20_000;

/**
 * Loopback-mode dashboard auth (Hermes v0.20.x): with the dashboard bound to
 * the VPS loopback, the SSH tunnel is the security boundary and the SPA HTML
 * carries an ephemeral session token (`window.__HERMES_SESSION_TOKEN__`)
 * echoed back on REST via this header and on WS upgrades via `?token=`.
 * The token rotates when the dashboard restarts, so a 401 triggers one
 * re-bootstrap + retry. Gated (non-loopback OAuth) deployments are detected
 * and reported as unsupported rather than half-working.
 */
const SESSION_HEADER = 'X-Hermes-Session-Token';

export interface RestProfile {
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  active?: boolean;
  path?: string;
  working_dir?: string;
}

const profileSchema = z
  .object({
    name: z.string(),
    description: z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined),
    provider: z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined),
    model: z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined),
    active: z.union([z.boolean(), z.number(), z.null()]).optional().transform((v) => (v == null ? undefined : Boolean(v))),
    path: z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined),
    working_dir: z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined),
  })
  .loose();

const profilesResponseSchema = z.union([
  z.array(profileSchema),
  z.object({ profiles: z.array(profileSchema) }).loose(),
]);

export interface RestSession {
  id: string;
  title?: string;
  preview?: string;
  updated_at?: string;
  created_at?: string;
  /** Hermes v0.20.x reports epoch-seconds floats, not ISO strings. */
  started_at?: number;
  ended_at?: number;
  profile?: string;
  active?: boolean;
  archived?: boolean;
  message_count?: number;
}

/**
 * Sessions come back with ~58 columns straight from Hermes' state DB, where
 * most optional values are `null` rather than absent, `archived` may be 0/1,
 * and timestamps are epoch floats. Accept all of that rather than rejecting a
 * legitimate response — unknown extra columns are ignored.
 */
const nullableString = z.union([z.string(), z.null()]).optional().transform((v) => v ?? undefined);
const nullableNumber = z.union([z.number(), z.null()]).optional().transform((v) => v ?? undefined);
const looseBool = z
  .union([z.boolean(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? undefined : Boolean(v)));

const sessionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    title: nullableString,
    preview: nullableString,
    updated_at: nullableString,
    created_at: nullableString,
    started_at: nullableNumber,
    ended_at: nullableNumber,
    profile: nullableString,
    active: looseBool,
    archived: looseBool,
    message_count: nullableNumber,
  })
  .loose();

const sessionsResponseSchema = z.union([
  z.array(sessionSchema),
  z.object({ sessions: z.array(sessionSchema) }).loose(),
  // /api/profiles/sessions/sidebar nests them under `recents` alongside
  // cron/messaging/errors panels we do not consume here.
  z.object({ recents: z.object({ sessions: z.array(sessionSchema) }).loose() }).loose(),
]);

const statusResponseSchema = z
  .object({
    version: z.string().optional(),
    hermes_version: z.string().optional(),
    status: z.string().optional(),
    ok: z.boolean().optional(),
  })
  .loose();

export interface ProviderOption {
  slug: string;
  name: string;
  models: string[];
  /** Whether this provider has usable credentials on the server. */
  authenticated: boolean;
  isCurrent: boolean;
}

export interface ModelOptions {
  providers: ProviderOption[];
  currentProvider?: string;
  currentModel?: string;
}

export interface CreateProfileRequest {
  name: string;
  clone_from?: string | null;
  clone_from_default?: boolean;
  clone_all?: boolean;
  no_skills?: boolean;
  description?: string;
  provider?: string;
  model?: string;
  keep_skills?: string[];
  hub_skills?: string[];
}

export class DashboardClient {
  private sessionToken: string | null = null;

  constructor(private readonly getPort: () => number | null) {}

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  clearSessionToken(): void {
    this.sessionToken = null;
  }

  /** Fetch the SPA shell and extract the loopback session token. */
  async bootstrapSessionToken(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(new URL('/', this.base()), { signal: controller.signal });
      const html = await res.text();
      const match = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
      if (match?.[1]) {
        this.sessionToken = match[1];
        registerSecret(this.sessionToken); // never allow it into logs
        log.info('rest', 'dashboard session token bootstrapped');
        return;
      }
      if (/__HERMES_AUTH_REQUIRED__\s*=\s*true/.test(html)) {
        throw new AppError(
          publicError(
            'hermes/schema-mismatch',
            'Gated dashboard not supported',
            'This Hermes dashboard runs in gated (OAuth) mode. The app currently supports loopback deployments reached over SSH; keep the dashboard bound to 127.0.0.1.',
            false,
          ),
        );
      }
      // No token and not gated: older builds without loopback token auth.
      this.sessionToken = null;
      log.info('rest', 'dashboard exposes no session token; proceeding without');
    } catch (err) {
      if (err instanceof AppError) throw err;
      const diag = recordDiagnostic('rest', `token bootstrap failed: ${(err as Error).message}`);
      throw new AppError(
        publicError('hermes/unavailable', 'Hermes unreachable', 'Could not load the dashboard shell through the tunnel.', true, diag),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private base(): string {
    const port = this.getPort();
    if (!port) {
      throw new AppError(
        publicError('hermes/unavailable', 'Not connected', 'The SSH tunnel is not established.', true),
      );
    }
    return `http://127.0.0.1:${port}`;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; profile?: string; schema?: z.ZodType<T>; notFoundOk?: boolean } = {},
    isRetryAfter401 = false,
  ): Promise<T> {
    const url = new URL(path, this.base());
    if (opts.profile) url.searchParams.set('profile', opts.profile);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      const headers: Record<string, string> = {};
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      if (this.sessionToken) headers[SESSION_HEADER] = this.sessionToken;
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const diag = recordDiagnostic('rest', `${method} ${path} network failure: ${(err as Error).message}`);
      throw new AppError(
        publicError('hermes/unavailable', 'Hermes unreachable', 'The dashboard did not respond through the tunnel.', true, diag),
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && !isRetryAfter401) {
      // The loopback token rotates on dashboard restart; refresh it once.
      log.warn('rest', `${method} ${path} -> 401; re-bootstrapping session token`);
      await this.bootstrapSessionToken();
      return this.request(method, path, opts, true);
    }

    if (res.status === 404 && opts.notFoundOk) {
      // Hermes persists a session row lazily on its first completed turn, so
      // a freshly created thread legitimately has no messages yet.
      return null as T;
    }

    if (!res.ok) {
      let bodyText = '';
      try {
        bodyText = (await res.text()).slice(0, 2000);
      } catch {
        /* body unreadable */
      }
      const diag = recordDiagnostic('rest', `${method} ${path} -> ${res.status} ${redact(bodyText)}`);
      throw new AppError(
        publicError(
          'hermes/http-error',
          `Hermes returned ${res.status}`,
          friendlyHttpMessage(res.status),
          res.status >= 500,
          diag,
        ),
      );
    }

    let json: unknown = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (opts.schema) {
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        const diag = recordDiagnostic(
          'rest',
          `${method} ${path} schema mismatch: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
        );
        throw new AppError(
          publicError('hermes/schema-mismatch', 'Unexpected Hermes response', 'This Hermes version returned a response the app does not recognize.', false, diag),
        );
      }
      return parsed.data;
    }
    return json as T;
  }

  // --- health --------------------------------------------------------------

  async status(): Promise<{ version?: string; latencyMs: number }> {
    const started = Date.now();
    const data = await this.request('GET', '/api/status', { schema: statusResponseSchema });
    return { version: data.version ?? data.hermes_version, latencyMs: Date.now() - started };
  }

  // --- profiles ------------------------------------------------------------

  async listProfiles(): Promise<RestProfile[]> {
    const data = await this.request('GET', '/api/profiles', { schema: profilesResponseSchema });
    return Array.isArray(data) ? data : data.profiles;
  }

  async createProfile(req: CreateProfileRequest): Promise<Record<string, unknown>> {
    return await this.request('POST', '/api/profiles', { body: req });
  }

  async deleteProfile(name: string): Promise<void> {
    await this.request('DELETE', `/api/profiles/${encodeURIComponent(name)}`);
  }

  async renameProfile(name: string, newName: string): Promise<void> {
    await this.request('PATCH', `/api/profiles/${encodeURIComponent(name)}`, {
      body: { new_name: newName },
    });
  }

  async setDescription(name: string, description: string): Promise<void> {
    await this.request('PUT', `/api/profiles/${encodeURIComponent(name)}/description`, {
      body: { description },
    });
  }

  async getSoul(name: string): Promise<string> {
    const data = await this.request<unknown>('GET', `/api/profiles/${encodeURIComponent(name)}/soul`);
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'content' in data) {
      return String((data as { content: unknown }).content ?? '');
    }
    return '';
  }

  async setSoul(name: string, content: string): Promise<void> {
    await this.request('PUT', `/api/profiles/${encodeURIComponent(name)}/soul`, {
      body: { content },
    });
  }

  async setProfileModel(name: string, provider: string, model: string): Promise<void> {
    await this.request('PUT', `/api/profiles/${encodeURIComponent(name)}/model`, {
      body: { provider, model },
    });
  }

  // --- sessions ------------------------------------------------------------

  async listSessions(profile?: string): Promise<RestSession[]> {
    const data = await this.request('GET', '/api/sessions', {
      profile,
      schema: sessionsResponseSchema,
    });
    return unwrapSessions(data);
  }


  async searchSessions(query: string, profile?: string): Promise<RestSession[]> {
    const port = this.getPort();
    if (!port) return [];
    const url = new URL('/api/sessions/search', `http://127.0.0.1:${port}`);
    url.searchParams.set('q', query);
    if (profile) url.searchParams.set('profile', profile);
    const data = await this.request('GET', url.pathname + url.search, {
      schema: sessionsResponseSchema,
    });
    return unwrapSessions(data);
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const data = await this.request<unknown>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      { notFoundOk: true },
    );
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray((data as { messages?: unknown[] }).messages)) {
      return (data as { messages: unknown[] }).messages;
    }
    return [];
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, {
      body: { title },
    });
  }

  async archiveSession(sessionId: string, archived: boolean): Promise<void> {
    await this.request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, {
      body: { archived },
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  // --- capabilities-related reads -----------------------------------------

  /**
   * Hermes answers with `{providers: [{slug, name, models[], authenticated,
   * is_current}], model, provider}` — not the flat {provider, model} pairs the
   * build spec implied. Normalize it so callers get a usable list.
   */
  async modelOptions(profile?: string): Promise<ModelOptions> {
    const raw = await this.request<unknown>('GET', '/api/model/options', { profile });
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const rows = Array.isArray(obj.providers) ? obj.providers : [];
    const providers: ProviderOption[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const slug = typeof r.slug === 'string' ? r.slug : undefined;
      if (!slug) continue;
      providers.push({
        slug,
        name: typeof r.name === 'string' ? r.name : slug,
        models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string') : [],
        authenticated: r.authenticated === true,
        isCurrent: r.is_current === true,
      });
    }
    return {
      providers,
      currentProvider: typeof obj.provider === 'string' ? obj.provider : undefined,
      currentModel: typeof obj.model === 'string' ? obj.model : undefined,
    };
  }

  async modelInfo(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/model/info', { profile });
  }

  async toolsets(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/tools/toolsets', { profile });
  }

  async skills(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/skills', { profile });
  }

  async mcp(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/mcp', { profile });
  }

  async logs(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/logs', { profile });
  }

  async usage(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/analytics/usage', { profile });
  }

  // --- messaging / gateway -------------------------------------------------

  async messagingPlatforms(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/messaging/platforms', { profile });
  }

  async configurePlatform(
    id: string,
    body: { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] },
    profile?: string,
  ): Promise<void> {
    await this.request('PUT', `/api/messaging/platforms/${encodeURIComponent(id)}`, {
      body,
      profile,
    });
  }

  async testPlatform(id: string, profile?: string): Promise<unknown> {
    return await this.request('POST', `/api/messaging/platforms/${encodeURIComponent(id)}/test`, {
      profile,
      body: {},
    });
  }

  async gateway(action: 'start' | 'stop' | 'restart', profile?: string): Promise<void> {
    await this.request('POST', `/api/gateway/${action}`, { profile, body: {} });
  }

  /** Cheap existence probe used by the capability adapter. */
  async probe(path: string, profile?: string): Promise<boolean> {
    const port = this.getPort();
    if (!port) return false;
    try {
      const url = new URL(path, `http://127.0.0.1:${port}`);
      if (profile) url.searchParams.set('profile', profile);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'GET',
        headers: this.sessionToken ? { [SESSION_HEADER]: this.sessionToken } : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.status < 500 && res.status !== 404 && res.status !== 401;
    } catch {
      return false;
    }
  }
}

/**
 * Accept the array, `{sessions}`, and sidebar `{recents:{sessions}}` shapes.
 * The schema validated the contents already; the loose catchall just erases
 * the static field types, so read them back positionally.
 */
function unwrapSessions(data: z.infer<typeof sessionsResponseSchema>): RestSession[] {
  if (Array.isArray(data)) return data as RestSession[];
  const obj = data as { sessions?: RestSession[]; recents?: { sessions?: RestSession[] } };
  return obj.sessions ?? obj.recents?.sessions ?? [];
}

function friendlyHttpMessage(status: number): string {
  if (status === 404) return 'This Hermes version does not provide the requested endpoint.';
  if (status === 400) return 'Hermes rejected the request as invalid.';
  if (status === 409) return 'The operation conflicts with current Hermes state.';
  if (status >= 500) return 'Hermes reported an internal error. The service may be restarting.';
  return 'Hermes rejected the request.';
}
