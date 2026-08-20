/** Hermes-facing IPC: bots, sessions, chat, approvals, Telegram, logs. */
import { z } from 'zod';
import { handle } from './validation';
import {
  profileNameSchema,
  sessionIdSchema,
  createBotSchema,
  submitPromptSchema,
  approvalResponseSchema,
  clarifyResponseSchema,
  secretResponseSchema,
  sudoResponseSchema,
  telegramConfigSchema,
  soulWriteSchema,
  setModelSchema,
  renameSessionSchema,
  orbMetadataSchema,
  deleteProfileSchema,
} from '@shared/schemas';
import { AppError, publicError } from '@shared/errors';
import type { AppController } from '../controller';

export function registerHermesIpc(controller: AppController): void {
  // --- bots ---------------------------------------------------------------

  handle('bots.list', null, () => controller.listBots());
  handle('bots.refresh', null, () => controller.refreshBots());

  handle('bots.create', createBotSchema, (input) => controller.createBot(input));

  handle('bots.delete', deleteProfileSchema, async ({ profileName, confirmation }) => {
    if (confirmation !== profileName) {
      throw new AppError(
        publicError(
          'ipc/invalid-request',
          'Confirmation mismatch',
          'Type the exact profile name to confirm deletion.',
          false,
        ),
      );
    }
    await controller.deleteBot(profileName);
    return true;
  });

  handle(
    'bots.rename',
    z.object({ profileName: profileNameSchema, newName: profileNameSchema }),
    async ({ profileName, newName }) => {
      await controller.rest_().renameProfile(profileName, newName);
      await controller.refreshBots();
      return true;
    },
  );

  handle(
    'bots.setDescription',
    z.object({ profileName: profileNameSchema, description: z.string().max(2000) }),
    async ({ profileName, description }) => {
      await controller.rest_().setDescription(profileName, description);
      await controller.refreshBots();
      return true;
    },
  );

  handle('bots.setOrb', orbMetadataSchema, ({ profileName, displayName, role, orb }) => {
    controller.setOrbMetadata(profileName, { displayName, role, orb });
    return true;
  });

  handle('bots.getConfig', z.object({ profileName: profileNameSchema }), ({ profileName }) =>
    controller.getProfileConfig(profileName),
  );

  handle('bots.setSoul', soulWriteSchema, async ({ profileName, content }) => {
    await controller.rest_().setSoul(profileName, content);
    return true;
  });

  handle('bots.setModel', setModelSchema, async ({ profileName, provider, model }) => {
    await controller.rest_().setProfileModel(profileName, provider, model);
    await controller.refreshBots();
    return true;
  });

  // --- threads / sessions --------------------------------------------------

  handle('threads.list', z.object({ profileName: profileNameSchema }), ({ profileName }) =>
    controller.refreshThreads(profileName),
  );

  handle(
    'threads.search',
    z.object({ profileName: profileNameSchema, query: z.string().max(200) }),
    ({ profileName, query }) => controller.searchThreads(query, profileName),
  );

  handle(
    'threads.history',
    z.object({ profileName: profileNameSchema, sessionId: sessionIdSchema }),
    async ({ profileName, sessionId }) => {
      const events = await controller.loadHistory(profileName, sessionId);
      await controller.activateSession(profileName, sessionId);
      return events;
    },
  );

  handle('threads.rename', renameSessionSchema, async ({ sessionId, title }) => {
    await controller.renameSession(sessionId, title);
    return true;
  });

  handle(
    'threads.archive',
    z.object({ sessionId: sessionIdSchema, archived: z.boolean() }),
    async ({ sessionId, archived }) => {
      await controller.archiveSession(sessionId, archived);
      return true;
    },
  );

  handle('threads.delete', z.object({ sessionId: sessionIdSchema }), async ({ sessionId }) => {
    await controller.deleteSession(sessionId);
    return true;
  });

  handle('threads.branch', z.object({ sessionId: sessionIdSchema }), ({ sessionId }) =>
    controller.branchSession(sessionId),
  );

  // --- chat ----------------------------------------------------------------

  handle('chat.submit', submitPromptSchema, (input) => controller.submitPrompt(input));

  handle('chat.interrupt', z.object({ sessionId: sessionIdSchema }), async ({ sessionId }) => {
    await controller.interrupt(sessionId);
    return true;
  });

  handle('chat.retry', z.object({ requestId: z.string().max(128) }), async ({ requestId }) => {
    await controller.retryPrompt(requestId);
    return true;
  });

  handle('chat.transcript', z.object({ sessionId: sessionIdSchema }), ({ sessionId }) =>
    controller.getTranscript(sessionId),
  );

  // --- approvals and input requests ---------------------------------------

  handle('approval.respond', approvalResponseSchema, async ({ sessionId, requestId, approve }) => {
    await controller.respondApproval(sessionId, requestId, approve);
    return true;
  });

  handle('clarify.respond', clarifyResponseSchema, async ({ sessionId, requestId, answer }) => {
    await controller.respondClarify(sessionId, requestId, answer);
    return true;
  });

  handle('sudo.respond', sudoResponseSchema, async ({ sessionId, requestId, password }) => {
    await controller.respondSudo(sessionId, requestId, password);
    return true;
  });

  handle(
    'secret.respond',
    secretResponseSchema,
    async ({ sessionId, requestId, value, cancelled }) => {
      await controller.respondSecret(sessionId, requestId, value, cancelled);
      return true;
    },
  );

  // --- messaging / gateway -------------------------------------------------

  handle('telegram.status', z.object({ profileName: profileNameSchema }), ({ profileName }) =>
    controller.telegramStatus(profileName),
  );

  handle('telegram.configure', telegramConfigSchema, (input) => controller.configureTelegram(input));

  handle('telegram.test', z.object({ profileName: profileNameSchema }), ({ profileName }) =>
    controller.testTelegram(profileName),
  );

  handle(
    'gateway.action',
    z.object({ profileName: profileNameSchema, action: z.enum(['start', 'stop', 'restart']) }),
    ({ profileName, action }) => controller.gatewayAction(profileName, action),
  );

  // --- logs ----------------------------------------------------------------

  handle('logs.get', z.object({ profileName: profileNameSchema.optional() }), ({ profileName }) =>
    controller.getLogs(profileName),
  );
}
