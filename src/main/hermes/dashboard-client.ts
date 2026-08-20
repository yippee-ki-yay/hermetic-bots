/**
 * Hermes Dashboard REST client (spec §12.1–§12.2). All requests go to the
 * loopback tunnel endpoint only. Responses are treated as untrusted input:
 * validated leniently, logged sanitized, and normalized before the renderer
 * ever sees them.
 */
import { z } from 'zod';
import { AppError, publicError } from '@shared/errors';
import { log, recordDiagnostic } from '../logging/logger';
import { redact } from '../logging/redaction';

const TIMEOUT_MS = 20_000;

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
    description: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    active: z.boolean().optional(),
    path: z.string().optional(),
    working_dir: z.string().optional(),
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
  profile?: string;
  active?: boolean;
  archived?: boolean;
  message_count?: number;
}

const sessionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    title: z.string().optional(),
    preview: z.string().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
    profile: z.string().optional(),
    active: z.boolean().optional(),
    archived: z.boolean().optional(),
    message_count: z.number().optional(),
  })
  .loose();

const sessionsResponseSchema = z.union([
  z.array(sessionSchema),
  z.object({ sessions: z.array(sessionSchema) }).loose(),
]);

const statusResponseSchema = z
  .object({
    version: z.string().optional(),
    hermes_version: z.string().optional(),
    status: z.string().optional(),
    ok: z.boolean().optional(),
  })
  .loose();

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
  constructor(private readonly getPort: () => number | null) {}

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
    opts: { body?: unknown; profile?: string; schema?: z.ZodType<T> } = {},
  ): Promise<T> {
    const url = new URL(path, this.base());
    if (opts.profile) url.searchParams.set('profile', opts.profile);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
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
    return Array.isArray(data) ? data : data.sessions;
  }

  async sidebarSessions(profile?: string): Promise<RestSession[] | null> {
    try {
      const data = await this.request('GET', '/api/profiles/sessions/sidebar', {
        profile,
        schema: sessionsResponseSchema,
      });
      return Array.isArray(data) ? data : data.sessions;
    } catch {
      return null; // fall back to /api/sessions
    }
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
    return Array.isArray(data) ? data : data.sessions;
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const data = await this.request<unknown>('GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages`);
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

  async modelOptions(profile?: string): Promise<unknown> {
    return await this.request('GET', '/api/model/options', { profile });
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
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return res.status < 500 && res.status !== 404;
    } catch {
      return false;
    }
  }
}

function friendlyHttpMessage(status: number): string {
  if (status === 404) return 'This Hermes version does not provide the requested endpoint.';
  if (status === 400) return 'Hermes rejected the request as invalid.';
  if (status === 409) return 'The operation conflicts with current Hermes state.';
  if (status >= 500) return 'Hermes reported an internal error. The service may be restarting.';
  return 'Hermes rejected the request.';
}
