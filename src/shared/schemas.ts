/**
 * Zod schemas validating every request crossing the IPC boundary (spec §11.2).
 * The main process rejects anything that fails these before touching state.
 */
import { z } from 'zod';

export const profileNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Profile names may use letters, digits, dot, dash, underscore');

export const sessionIdSchema = z.string().min(1).max(128);
export const requestIdSchema = z.string().uuid();

export const connectConfigSchema = z.object({
  label: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  authMethod: z.enum(['agent', 'key-file', 'ssh-config-host']),
  keyPath: z.string().max(1024).optional(),
  sshConfigHost: z.string().max(255).optional(),
  remotePort: z.number().int().min(1).max(65535),
});
export type ConnectConfigInput = z.infer<typeof connectConfigSchema>;

export const orbDefinitionSchema = z.object({
  paletteId: z.string().max(32),
  ringCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tickPattern: z.number().int().min(0).max(1023),
  seed: z.string().max(64),
});

export const createBotSchema = z.object({
  name: profileNameSchema,
  displayName: z.string().min(1).max(80),
  role: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  orb: orbDefinitionSchema,
  soul: z.string().max(200_000).optional(),
  provider: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  cloneFrom: z.string().max(64).nullable().optional(),
  keepSkills: z.array(z.string().max(128)).max(200).optional(),
});

export const submitPromptSchema = z.object({
  profileName: profileNameSchema,
  sessionId: sessionIdSchema.nullable(),
  requestId: requestIdSchema,
  text: z.string().min(1).max(200_000),
  mode: z.enum(['normal', 'steer', 'background']).default('normal'),
});

export const approvalResponseSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(128),
  approve: z.boolean(),
});

export const clarifyResponseSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(128),
  answer: z.string().max(20_000),
});

export const secretResponseSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(128),
  /** Forwarded straight to the gateway; never persisted or logged. */
  value: z.string().max(10_000),
  cancelled: z.boolean().default(false),
});

export const sudoResponseSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(128),
  approve: z.boolean(),
});

export const telegramConfigSchema = z.object({
  profileName: profileNameSchema,
  /** Held only in transit main-process side; cleared after the request. */
  token: z.string().min(10).max(200).optional(),
  mentionOnly: z.boolean().optional(),
  allowedUsers: z.array(z.string().max(64)).max(100).optional(),
  enabled: z.boolean().optional(),
  removeToken: z.boolean().optional(),
});

export const soulWriteSchema = z.object({
  profileName: profileNameSchema,
  content: z.string().max(500_000),
});

export const setModelSchema = z.object({
  profileName: profileNameSchema,
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
});

export const renameSessionSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string().min(1).max(200),
});

export const draftSchema = z.object({
  key: z.string().max(256),
  text: z.string().max(200_000),
});

export const preferencesSchema = z.object({
  enterToSend: z.boolean(),
  notifyApprovals: z.boolean(),
  notifyCompletedRuns: z.boolean(),
  notifyConnectionFailures: z.boolean(),
  reconnectOnLaunch: z.boolean(),
  theme: z.enum(['system', 'dark']),
});

export const orbMetadataSchema = z.object({
  profileName: profileNameSchema,
  displayName: z.string().min(1).max(80).optional(),
  role: z.string().max(120).optional(),
  orb: orbDefinitionSchema.optional(),
});

export const externalUrlSchema = z.object({
  url: z.string().url().max(2048),
});

export const deleteProfileSchema = z.object({
  profileName: profileNameSchema,
  /** Renderer must pass the exact typed confirmation (spec §9.5). */
  confirmation: z.string(),
});
