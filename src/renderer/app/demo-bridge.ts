/**
 * In-memory HermesApi used when the preload bridge is absent — i.e. when the
 * renderer runs in a plain browser for design review and visual regression.
 * It simulates a healthy connection, four personas, sessions, streaming,
 * tool events, and an approval flow. No network access of any kind.
 */
import type { HermesApi, IpcResult, ConnectionStatePayload } from '../../preload/api-types';
import type {
  BotSummary,
  ThreadSummary,
  TranscriptEvent,
  ConnectionSummary,
  Capabilities,
  PushEnvelope,
  AppPreferences,
  TelegramStatus,
} from '@shared/contracts';
import { DEFAULT_PREFERENCES } from '@shared/contracts';

function ok<T>(data: T): Promise<IpcResult<T>> {
  return Promise.resolve({ ok: true, data });
}

const now = Date.now();
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();

/** Flat teal square — enough to prove the image path renders and crops. */
const DEMO_AVATAR =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#2b6f78"/><circle cx="96" cy="74" r="34" fill="#edf5f6"/><path d="M28 192c0-38 30-62 68-62s68 24 68 62z" fill="#edf5f6"/></svg>',
  );

export function createDemoBridge(): HermesApi {
  const listeners = new Set<(e: PushEnvelope) => void>();
  const emit = (event: PushEnvelope['event']): void => {
    for (const l of listeners) l({ v: 1, event });
  };

  let prefs: AppPreferences = { ...DEFAULT_PREFERENCES };

  const connection: ConnectionSummary = {
    id: 'demo',
    label: 'Hermes VPS',
    host: '203.0.113.10',
    port: 22,
    user: 'root',
    status: 'online',
    hermesVersion: '0.20.4',
    latencyMs: 84,
    localPort: 52113,
    tunnelUptimeSec: 4620,
    retryCount: 0,
    hostFingerprint: 'SHA256:mVfz3FQm9tJc8yQxkQ0WEXAMPLEDEMOfingerprint00',
    lastCheckedAt: iso(12_000),
  };

  const capabilities: Capabilities = {
    hermesVersion: '0.20.4',
    profilesCreate: true,
    profilesSoul: true,
    profilesRename: true,
    profilesDelete: true,
    chatStreaming: true,
    sessionBranch: true,
    sessionCompress: true,
    messagingTelegram: true,
    gatewayControl: true,
    cronManage: false,
    logs: true,
    usage: true,
    mcp: true,
    skills: true,
  };

  const bots: BotSummary[] = [
    {
      profileName: 'chief',
      displayName: 'Chief',
      role: 'Chief of Staff',
      description: 'Coordinates daily priorities and drafts',
      orb: { paletteId: 'cyan', ringCount: 2, tickPattern: 137, seed: 'chief' },
      provider: 'grok',
      model: 'grok-4.5',
      runState: 'idle',
      gatewayState: 'online',
      unreadCount: 0,
    },
    {
      profileName: 'researcher',
      displayName: 'Researcher',
      role: 'Deep research',
      description: 'Long-running research and memo writing',
      orb: { paletteId: 'lavender', ringCount: 3, tickPattern: 74, seed: 'researcher' },
      provider: 'grok',
      model: 'grok-4.5',
      runState: 'running',
      gatewayState: 'online',
      unreadCount: 2,
    },
    {
      profileName: 'ops',
      displayName: 'Ops',
      role: 'Operations',
      description: 'Server chores and scheduled routines',
      orb: { paletteId: 'amber', ringCount: 1, tickPattern: 261, seed: 'ops' },
      provider: 'grok',
      model: 'grok-4.5',
      runState: 'attention',
      gatewayState: 'degraded',
      unreadCount: 0,
    },
    {
      profileName: 'pnl-analyst',
      displayName: 'PnL Analyst',
      role: 'Trading analytics',
      description: 'Reads reports; never signs or submits transactions',
      orb: { paletteId: 'sage', ringCount: 2, tickPattern: 402, seed: 'pnl-analyst' },
      provider: 'grok',
      model: 'grok-4.5',
      runState: 'idle',
      gatewayState: 'disabled',
      unreadCount: 0,
    },
  ];

  const threads = new Map<string, ThreadSummary[]>([
    [
      'researcher',
      [
        {
          id: 'r-1',
          profileName: 'researcher',
          title: 'Memory systems survey',
          preview: 'Comparing episodic buffers against vector stores for agent memory…',
          updatedAt: iso(300_000),
          state: 'active',
          unread: true,
        },
        {
          id: 'r-2',
          profileName: 'researcher',
          title: 'Grok 4.5 eval notes',
          preview: 'Summarized the long-context regressions; three follow-ups flagged.',
          updatedAt: iso(5_400_000),
          state: 'idle',
          unread: false,
        },
        {
          id: 'r-3',
          profileName: 'researcher',
          title: 'Telegram digest format',
          preview: 'Drafted the compact daily digest template with per-bot sections.',
          updatedAt: iso(90_000_000),
          state: 'archived',
          unread: false,
        },
      ],
    ],
    [
      'chief',
      [
        {
          id: 'c-1',
          profileName: 'chief',
          title: 'Monday planning',
          preview: 'Top three: VPS backup audit, wizard QA pass, invoice batch.',
          updatedAt: iso(1_200_000),
          state: 'idle',
          unread: false,
        },
      ],
    ],
    [
      'ops',
      [
        {
          id: 'o-1',
          profileName: 'ops',
          title: 'Disk cleanup routine',
          preview: 'Awaiting approval to prune /var/log archives older than 30 days.',
          updatedAt: iso(600_000),
          state: 'attention',
          unread: false,
        },
      ],
    ],
    ['pnl-analyst', []],
  ]);

  const transcripts = new Map<string, TranscriptEvent[]>([
    [
      'r-1',
      [
        {
          id: 'u1',
          sessionId: 'r-1',
          profileName: 'researcher',
          at: iso(1_800_000),
          kind: 'user',
          text: 'Compare episodic memory buffers with plain vector stores for our agent. Keep it practical.',
          requestId: 'req-1',
          delivery: 'complete',
        },
        {
          id: 'a1',
          sessionId: 'r-1',
          profileName: 'researcher',
          at: iso(1_740_000),
          kind: 'assistant',
          streaming: false,
          model: 'grok-4.5',
          text: 'Practical comparison for a single-operator agent:\n\n**Episodic buffer**\n- Keeps recency and causality; replay is cheap.\n- Bounded size forces summarization discipline.\n\n**Vector store**\n- Better for long-horizon recall across sessions.\n- Needs hygiene: dedupe, TTLs, and provenance or it drifts.\n\nRecommendation: keep the episodic buffer as the working set and snapshot durable facts into the store with a `source` field. I can draft the schema next.',
        },
        {
          id: 't1',
          sessionId: 'r-1',
          profileName: 'researcher',
          at: iso(900_000),
          kind: 'tool',
          toolCallId: 't1',
          toolName: 'web.search',
          status: 'complete',
          elapsedMs: 2400,
          inputPreview: '{"query":"agent episodic memory vs vector store 2026"}',
          outputPreview: '12 results; 4 relevant. Top: "Memory architectures for persistent agents".',
        },
        {
          id: 'u2',
          sessionId: 'r-1',
          profileName: 'researcher',
          at: iso(600_000),
          kind: 'user',
          text: 'Draft the snapshot schema, then write it to memory/schema.md.',
          requestId: 'req-2',
          delivery: 'complete',
        },
        {
          id: 'appr1',
          sessionId: 'r-1',
          profileName: 'researcher',
          at: iso(540_000),
          kind: 'approval',
          requestId: 'appr-1',
          summary: 'Write file memory/schema.md (2.1 KB) in the profile workspace',
          detail: 'tool: fs.write\npath: memory/schema.md\nbytes: 2148',
          risk: 'Mutating tool: writes to the server filesystem.',
          decision: 'pending',
        },
      ],
    ],
    [
      'o-1',
      [
        {
          id: 'ou1',
          sessionId: 'o-1',
          profileName: 'ops',
          at: iso(700_000),
          kind: 'user',
          text: 'Free up disk space on the VPS. Show me what you would delete first.',
          requestId: 'req-3',
          delivery: 'complete',
        },
        {
          id: 'ot1',
          sessionId: 'o-1',
          profileName: 'ops',
          at: iso(660_000),
          kind: 'tool',
          toolCallId: 'ot1',
          toolName: 'terminal.run',
          status: 'complete',
          elapsedMs: 1330,
          inputPreview: 'du -sh /var/log/* | sort -rh | head -20',
          outputPreview: '1.9G /var/log/journal\n412M /var/log/hermes\n88M /var/log/nginx…',
        },
        {
          id: 'osudo',
          sessionId: 'o-1',
          profileName: 'ops',
          at: iso(600_000),
          kind: 'sudo',
          requestId: 'sudo-1',
          commandSummary: 'journalctl --vacuum-time=30d',
          decision: 'pending',
        },
      ],
    ],
  ]);

  let streamTimer: ReturnType<typeof setInterval> | null = null;

  const telegramState = new Map<string, TelegramStatus>([
    ['researcher', { configured: true, enabled: true, state: 'online', mentionOnly: true, lastCheckedAt: iso(30_000) }],
    ['chief', { configured: true, enabled: true, state: 'online', lastCheckedAt: iso(30_000) }],
    ['ops', { configured: true, enabled: true, state: 'degraded', recentErrors: ['getUpdates timeout after 25s'], lastCheckedAt: iso(30_000) }],
    ['pnl-analyst', { configured: false, enabled: false, state: 'disabled' }],
  ]);

  const payload: ConnectionStatePayload = {
    connection,
    capabilities,
    trustPrompt: null,
    configured: true,
    storedConfig: {
      label: 'Hermes VPS',
      host: '203.0.113.10',
      port: 22,
      user: 'root',
      authMethod: 'agent',
      remotePort: 9119,
    },
  };

  return {
    connection: {
      get: () => ok(payload),
      connect: () => ok(connection),
      reconnect: () => ok(connection),
      sync: () => {
        emit({ type: 'bots.updated', bots });
        return ok(true);
      },
      disconnect: () => ok({ ...connection, status: 'idle' as const }),
      confirmHostKey: () => ok(connection),
      test: () => ok(connection),
      diagnostics: () => ok('demo diagnostics report\nno secrets here'),
      copyDiagnostics: () => ok(true),
    },
    prefs: {
      get: () => ok(prefs),
      set: (p) => {
        prefs = p;
        return ok(p);
      },
    },
    route: {
      get: () => ok(null),
      set: () => ok(true),
    },
    drafts: {
      get: () => ok(null),
      set: () => ok(true),
    },
    privacy: { clearLocal: () => ok(true) },
    external: { open: () => ok(true) },
    bots: {
      list: () => ok(bots),
      refresh: () => ok(bots),
      create: (input) =>
        ok({
          ok: true,
          profileName: input.name,
          steps: [
            { step: 'profile' as const, ok: true },
            { step: 'soul' as const, ok: true },
          ],
        }),
      delete: () => ok(true),
      rename: () => ok(true),
      setDescription: () => ok(true),
      setOrb: () => ok(true),
      getConfig: () =>
        ok({
          soul: '# Role\nYou are Researcher, a rigorous long-form research persona.\n\n# Mission\nProduce careful, sourced analysis.\n\n# Boundaries\nNever fabricate citations. Escalate paywalled sources.',
          modelInfo: { provider: 'grok', model: 'grok-4.5' },
          modelOptions: {
            options: [
              { provider: 'grok', model: 'grok-4.5' },
              { provider: 'grok', model: 'grok-4-mini' },
            ],
          },
          toolsets: {
            toolsets: [
              { id: 'web', name: 'Web research', enabled: true },
              { id: 'fs', name: 'Files', enabled: true },
              { id: 'terminal', name: 'Terminal', enabled: false },
            ],
          },
          skills: { skills: [{ id: 'memo', name: 'Memo writer', enabled: true }] },
          mcp: { servers: [] },
        }),
      setSoul: () => ok(true),
      setModel: () => ok(true),
    },
    avatar: {
      // No native dialog outside Electron; demo mode paints a stand-in so the
      // picture path is still reviewable in a browser.
      pick: () => ok(DEMO_AVATAR),
      set: (profileName, dataUri) => {
        const bot = bots.find((b) => b.profileName === profileName);
        if (bot) {
          const updated = { ...bot, avatarDataUri: dataUri };
          bots.splice(bots.indexOf(bot), 1, updated);
          emit({ type: 'bot.updated', bot: updated });
        }
        return ok(dataUri);
      },
      clear: (profileName) => {
        const bot = bots.find((b) => b.profileName === profileName);
        if (bot) {
          const updated = { ...bot, avatarDataUri: undefined };
          bots.splice(bots.indexOf(bot), 1, updated);
          emit({ type: 'bot.updated', bot: updated });
        }
        return ok(true);
      },
    },
    threads: {
      list: (profileName) => ok(threads.get(profileName) ?? []),
      search: (profileName, query) =>
        ok(
          (threads.get(profileName) ?? []).filter((t) =>
            t.title.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
      history: (_profileName, sessionId) => ok(transcripts.get(sessionId) ?? []),
      rename: () => ok(true),
      archive: () => ok(true),
      delete: () => ok(true),
      branch: () => ok(null),
    },
    chat: {
      submit: ({ profileName, sessionId, requestId, text }) => {
        const sid = sessionId ?? `new-${Date.now()}`;
        emit({
          type: 'transcript.event',
          event: {
            id: `user-${requestId}`,
            sessionId: sid,
            profileName,
            at: new Date().toISOString(),
            kind: 'user',
            text,
            requestId,
            delivery: 'acknowledged',
          },
        });
        emit({ type: 'run.state', sessionId: sid, runState: 'thinking' });
        const reply =
          'Demo mode: this reply is generated locally so the interface can be reviewed without a server. Streaming, tools, and approvals all render from the same normalized event union used in production.';
        let i = 0;
        const eventId = `assistant-demo-${Date.now()}`;
        if (streamTimer) clearInterval(streamTimer);
        emit({
          type: 'transcript.event',
          event: {
            id: eventId,
            sessionId: sid,
            profileName,
            at: new Date().toISOString(),
            kind: 'assistant',
            text: '',
            streaming: true,
          },
        });
        streamTimer = setInterval(() => {
          i += 4;
          emit({
            type: 'transcript.delta',
            sessionId: sid,
            eventId,
            textDelta: reply.slice(i - 4, i),
          });
          if (i >= reply.length) {
            if (streamTimer) clearInterval(streamTimer);
            emit({
              type: 'transcript.event',
              event: {
                id: eventId,
                sessionId: sid,
                profileName,
                at: new Date().toISOString(),
                kind: 'assistant',
                text: reply,
                streaming: false,
              },
            });
            emit({ type: 'run.state', sessionId: sid, runState: 'ready' });
          }
        }, 30);
        return ok({ sessionId: sid });
      },
      interrupt: (sessionId) => {
        if (streamTimer) clearInterval(streamTimer);
        emit({ type: 'run.state', sessionId, runState: 'ready' });
        return ok(true);
      },
      retry: () => ok(true),
      transcript: (sessionId) => ok(transcripts.get(sessionId) ?? []),
    },
    approvals: {
      respondApproval: (sessionId, requestId, approve) => {
        const list = transcripts.get(sessionId) ?? [];
        const evt = list.find((e) => 'requestId' in e && e.requestId === requestId);
        if (evt && evt.kind === 'approval') {
          const updated = { ...evt, decision: approve ? ('approved' as const) : ('denied' as const) };
          emit({ type: 'transcript.event', event: updated });
        }
        return ok(true);
      },
      respondClarify: () => ok(true),
      respondSudo: (sessionId, requestId, password) => {
        const list = transcripts.get(sessionId) ?? [];
        const evt = list.find((e) => 'requestId' in e && e.requestId === requestId);
        if (evt && evt.kind === 'sudo') {
          const updated = { ...evt, decision: password ? ('answered' as const) : ('denied' as const) };
          emit({ type: 'transcript.event', event: updated });
        }
        return ok(true);
      },
      respondSecret: () => ok(true),
    },
    telegram: {
      status: (profileName) =>
        ok(telegramState.get(profileName) ?? { configured: false, enabled: false, state: 'disabled' as const }),
      configure: (input) => {
        const status: TelegramStatus = {
          configured: !input.removeToken,
          enabled: input.enabled ?? true,
          state: input.removeToken ? 'disabled' : 'online',
          mentionOnly: input.mentionOnly,
          allowedUsers: input.allowedUsers,
          lastCheckedAt: new Date().toISOString(),
        };
        telegramState.set(input.profileName, status);
        return ok(status);
      },
      test: () => ok({ ok: true, message: 'Connection test passed (demo)' }),
      gateway: (profileName) =>
        ok(telegramState.get(profileName) ?? { configured: false, enabled: false, state: 'disabled' as const }),
    },
    personas: {
      // The real catalogue is a main-process resource; demo mode ships a few
      // entries so the picker is still reviewable in a browser.
      index: () =>
        ok({
          divisions: ['engineering', 'strategy'],
          personas: [
            {
              id: 'engineering-backend-architect',
              name: 'Backend Architect',
              division: 'engineering',
              description: 'Scalable system design, database architecture, and cloud infrastructure.',
              vibe: 'Designs the systems that hold everything up.',
            },
            {
              id: 'strategy-chief-of-staff',
              name: 'Chief of Staff',
              division: 'strategy',
              description: 'Turns scattered inputs into priorities, drafts, and follow-ups.',
              vibe: 'Protects your attention.',
            },
          ],
          attribution: { repo: 'msitarzewski/agency-agents', url: '', license: 'MIT' },
        }),
      soul: () => ok('# Role\nDemo persona body.\n'),
    },
    logs: {
      get: () =>
        ok([
          { at: iso(60_000), level: 'info' as const, scope: 'tunnel', message: 'state starting-tunnel -> checking-hermes' },
          { at: iso(58_000), level: 'info' as const, scope: 'tunnel', message: 'state checking-hermes -> online' },
          { at: iso(30_000), level: 'info' as const, scope: 'ws', message: 'gateway connected' },
          { at: iso(10_000), level: 'warn' as const, scope: 'gateway', message: 'telegram getUpdates timeout after 25s (profile ops)' },
        ]),
    },
    app: { version: () => ok('0.1.0-demo') },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
