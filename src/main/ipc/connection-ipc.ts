/** Connection, health, preferences, drafts, and diagnostics IPC. */
import { z } from 'zod';
import { shell, app, clipboard } from 'electron';
import { handle } from './validation';
import {
  connectConfigSchema,
  preferencesSchema,
  draftSchema,
  externalUrlSchema,
} from '@shared/schemas';
import type { AppController } from '../controller';
import { encryptString, decryptString } from '../storage/secure-store';
import { AppError, publicError } from '@shared/errors';
import { log } from '../logging/logger';

export function registerConnectionIpc(controller: AppController): void {
  handle('connection.get', null, () => ({
    connection: controller.connectionSummary(),
    capabilities: controller.getCapabilities(),
    trustPrompt: controller.getTrustPrompt(),
    configured: Boolean(controller.settings.connection),
    storedConfig: controller.settings.connection
      ? {
          label: controller.settings.connection.label,
          host: controller.settings.connection.host,
          port: controller.settings.connection.port,
          user: controller.settings.connection.user,
          authMethod: controller.settings.connection.authMethod,
          keyPathLabel: controller.settings.connection.keyPath,
          sshConfigHost: controller.settings.connection.sshConfigHost,
          remotePort: controller.settings.connection.remotePort,
        }
      : null,
  }));

  handle('connection.connect', connectConfigSchema, async (config) => {
    await controller.connect(config);
    return controller.connectionSummary();
  });

  handle('connection.reconnect', null, async () => {
    await controller.reconnect();
    return controller.connectionSummary();
  });

  handle('connection.disconnect', null, async () => {
    await controller.disconnect();
    return controller.connectionSummary();
  });

  handle('connection.confirmHostKey', z.object({ accept: z.boolean() }), async ({ accept }) => {
    await controller.confirmHostKey(accept);
    return controller.connectionSummary();
  });

  handle('connection.test', null, async () => {
    await controller.healthCheck();
    return controller.connectionSummary();
  });

  handle('connection.diagnostics', null, () => controller.diagnosticsReport());

  handle('connection.copyDiagnostics', null, () => {
    clipboard.writeText(controller.diagnosticsReport());
    return true;
  });

  // --- preferences ---------------------------------------------------------

  handle('prefs.get', null, () => controller.settings.preferences);
  handle('prefs.set', preferencesSchema, (prefs) => {
    controller.settings.setPreferences(prefs);
    return prefs;
  });

  handle('route.get', null, () => controller.settings.lastRoute ?? null);
  handle('route.set', z.object({ route: z.string().max(512) }), ({ route }) => {
    controller.settings.setLastRoute(route);
    return true;
  });

  // --- drafts (optional encrypted persistence, spec §7.1) ------------------

  handle('draft.get', z.object({ key: z.string().max(256) }), ({ key }) => {
    const blob = controller.settings.getEncryptedDraft(key);
    if (!blob) return null;
    return decryptString(blob) ?? null;
  });

  handle('draft.set', draftSchema, ({ key, text }) => {
    if (!text) {
      controller.settings.setEncryptedDraft(key, undefined);
      return true;
    }
    const blob = encryptString(text);
    if (blob) controller.settings.setEncryptedDraft(key, blob);
    return true;
  });

  handle('privacy.clearLocal', null, () => {
    controller.settings.clearLocalData();
    return true;
  });

  // --- external links (spec §11.3): vetted https via system browser only ---

  handle('external.open', externalUrlSchema, async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new AppError(
        publicError('ipc/invalid-request', 'Blocked link', 'Only https links can be opened externally.', false),
      );
    }
    log.info('external', `opening ${parsed.hostname} in system browser`);
    await shell.openExternal(parsed.toString());
    return true;
  });

  handle('app.version', null, () => app.getVersion());
}
