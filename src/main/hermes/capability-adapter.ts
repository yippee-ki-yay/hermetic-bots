/**
 * Capability adapter. Probes only what the visible feature set
 * needs, once per connection, and produces a single Capabilities object.
 * Version checks live here, never scattered through React components.
 */
import type { Capabilities } from '@shared/contracts';
import type { DashboardClient } from './dashboard-client';
import { log } from '../logging/logger';

export function defaultCapabilities(): Capabilities {
  return {
    profilesCreate: false,
    profilesSoul: false,
    profilesRename: false,
    profilesDelete: false,
    chatStreaming: false,
    sessionBranch: false,
    sessionCompress: false,
    messagingTelegram: false,
    gatewayControl: false,
    cronManage: false,
    logs: false,
    usage: false,
    mcp: false,
    skills: false,
  };
}

export async function detectCapabilities(
  client: DashboardClient,
  hermesVersion: string | undefined,
  firstProfile: string | undefined,
): Promise<Capabilities> {
  const caps = defaultCapabilities();
  caps.hermesVersion = hermesVersion;

  // /api/profiles worked before this is called, so profile CRUD is assumed
  // present in v0.20+; destructive endpoints degrade at call time if absent.
  caps.profilesCreate = true;
  caps.profilesRename = true;
  caps.profilesDelete = true;
  caps.chatStreaming = true; // via /api/ws; degraded at runtime if the socket fails
  caps.sessionBranch = true; // mapped to disabled state on method-not-found
  caps.sessionCompress = true;

  const probes: [keyof Capabilities, string][] = [
    ['profilesSoul', firstProfile ? `/api/profiles/${encodeURIComponent(firstProfile)}/soul` : '/api/profiles'],
    ['messagingTelegram', '/api/messaging/platforms'],
    ['gatewayControl', '/api/messaging/platforms'],
    ['logs', '/api/logs'],
    ['usage', '/api/analytics/usage'],
    ['mcp', '/api/mcp'],
    ['skills', '/api/skills'],
  ];

  const results = await Promise.all(
    probes.map(async ([key, path]) => ({ key, ok: await client.probe(path, firstProfile) })),
  );
  for (const { key, ok } of results) {
    (caps as unknown as Record<string, boolean | string | undefined>)[key] = ok;
  }
  // cron manage deferred post-MVP; keep detection cheap for now.
  caps.cronManage = false;

  log.info(
    'capabilities',
    `detected: ${Object.entries(caps)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .join(', ')}`,
  );
  return caps;
}
