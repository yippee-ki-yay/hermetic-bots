/**
 * Renderer state (spec §14). The main process owns truth; this store holds
 * view models replenished over IPC plus purely local UI state.
 */
import { create } from 'zustand';
import { api, unwrap, ApiError } from '../app/api';
import type {
  AppPreferences,
  BotSummary,
  Capabilities,
  ConnectionSummary,
  HostTrustPrompt,
  PushEnvelope,
  RunState,
  ThreadSummary,
  TranscriptEvent,
} from '@shared/contracts';
import { DEFAULT_PREFERENCES } from '@shared/contracts';
import type { ConnectionStatePayload } from '../../preload/api-types';
import type { PublicError } from '@shared/errors';

export type Route =
  | { view: 'welcome' }
  | { view: 'chat'; profile: string; sessionId: string | null }
  | { view: 'bot-settings'; profile: string; tab: BotTab }
  | { view: 'wizard'; step: number }
  | { view: 'connection' }
  | { view: 'settings' };

export type BotTab =
  | 'overview'
  | 'persona'
  | 'capabilities'
  | 'telegram'
  | 'sessions'
  | 'routines'
  | 'logs';

export type ThreadFilter = 'all' | 'active' | 'scheduled' | 'archived';

export interface Toast {
  id: number;
  title: string;
  message?: string;
  error?: boolean;
}

interface AppState {
  booted: boolean;
  route: Route;
  connection: ConnectionSummary | null;
  capabilities: Capabilities | null;
  trustPrompt: HostTrustPrompt | null;
  configured: boolean;
  storedConfig: ConnectionStatePayload['storedConfig'];
  prefs: AppPreferences;
  bots: BotSummary[];
  threads: Record<string, ThreadSummary[]>;
  transcripts: Record<string, TranscriptEvent[]>;
  runStates: Record<string, RunState>;
  drafts: Record<string, string>;
  threadFilter: ThreadFilter;
  threadSearch: string;
  paletteOpen: boolean;
  toasts: Toast[];

  boot(): Promise<void>;
  navigate(route: Route): void;
  selectBot(profile: string): void;
  applyEvent(envelope: PushEnvelope): void;
  loadThreads(profile: string): Promise<void>;
  openSession(profile: string, sessionId: string): Promise<void>;
  setDraft(key: string, text: string): void;
  setThreadFilter(f: ThreadFilter): void;
  setThreadSearch(q: string): void;
  setPaletteOpen(open: boolean): void;
  toast(title: string, message?: string, error?: boolean): void;
  dismissToast(id: number): void;
  reportError(err: unknown, fallback: string): void;
  setPrefs(prefs: AppPreferences): Promise<void>;
}

let toastSeq = 1;

/**
 * Batches streaming deltas into one store update per animation frame (§9.3),
 * with a timeout fallback so a hidden window (rAF throttled/paused) still
 * applies deltas and never shows a stale transcript on refocus.
 */
const deltaQueue: { sessionId: string; eventId: string; text: string }[] = [];
let deltaFlushScheduled = false;

function scheduleDeltaFlush(flush: () => void): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    flush();
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

function routeToString(route: Route): string {
  return JSON.stringify(route);
}

function routeFromString(raw: string | null): Route | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Route;
    if (parsed && typeof parsed === 'object' && 'view' in parsed) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export const useStore = create<AppState>((set, get) => ({
  booted: false,
  route: { view: 'welcome' },
  connection: null,
  capabilities: null,
  trustPrompt: null,
  configured: false,
  storedConfig: null,
  prefs: DEFAULT_PREFERENCES,
  bots: [],
  threads: {},
  transcripts: {},
  runStates: {},
  drafts: {},
  threadFilter: 'all',
  threadSearch: '',
  paletteOpen: false,
  toasts: [],

  async boot() {
    api().onEvent((envelope) => get().applyEvent(envelope));
    try {
      const [payload, prefs, savedRoute] = await Promise.all([
        unwrap(api().connection.get()),
        unwrap(api().prefs.get()),
        unwrap(api().route.get()),
      ]);
      const restored = routeFromString(savedRoute);
      set({
        booted: true,
        connection: payload.connection,
        capabilities: payload.capabilities,
        trustPrompt: payload.trustPrompt,
        configured: payload.configured,
        storedConfig: payload.storedConfig,
        prefs,
        route: payload.configured ? (restored ?? { view: 'connection' }) : { view: 'welcome' },
      });
      if (payload.configured) {
        try {
          const bots = await unwrap(api().bots.list());
          set({ bots });
          const current = get().route;
          if (bots.length > 0 && current.view === 'connection' && payload.connection.status === 'online') {
            const first = bots[0]!;
            get().navigate({ view: 'chat', profile: first.profileName, sessionId: null });
          }
          if (current.view === 'chat') {
            void get().loadThreads(current.profile);
            if (current.sessionId) void get().openSession(current.profile, current.sessionId);
          }
        } catch {
          /* not connected yet; events will refresh */
        }
      }
    } catch (err) {
      set({ booted: true });
      get().reportError(err, 'Startup failed');
    }
  },

  navigate(route) {
    set({ route });
    void api().route.set(routeToString(route));
    if (route.view === 'chat') {
      const state = get();
      if (!state.threads[route.profile]) void state.loadThreads(route.profile);
      if (route.sessionId && !state.transcripts[route.sessionId]) {
        void state.openSession(route.profile, route.sessionId);
      }
    }
  },

  selectBot(profile) {
    const state = get();
    const threads = state.threads[profile];
    const first = threads?.find((t) => t.state !== 'archived');
    state.navigate({ view: 'chat', profile, sessionId: first?.id ?? null });
  },

  applyEvent(envelope) {
    const event = envelope.event;
    switch (event.type) {
      case 'connection.state': {
        const wasOnline = get().connection?.status === 'online';
        set({ connection: event.connection });
        if (!wasOnline && event.connection.status === 'online') {
          void unwrap(api().bots.list()).then((bots) => {
            set({ bots });
            const route = get().route;
            if ((route.view === 'welcome' || route.view === 'connection') && bots.length > 0) {
              get().navigate({ view: 'chat', profile: bots[0]!.profileName, sessionId: null });
            }
          }).catch(() => undefined);
        }
        return;
      }
      case 'connection.trust-prompt':
        set({ trustPrompt: event.prompt });
        return;
      case 'capabilities':
        set({ capabilities: event.capabilities });
        return;
      case 'bots.updated':
        set({ bots: event.bots });
        return;
      case 'bot.updated':
        set({
          bots: get().bots.map((b) => (b.profileName === event.bot.profileName ? event.bot : b)),
        });
        return;
      case 'threads.updated':
        set({ threads: { ...get().threads, [event.profileName]: event.threads } });
        return;
      case 'thread.updated': {
        const list = get().threads[event.thread.profileName] ?? [];
        set({
          threads: {
            ...get().threads,
            [event.thread.profileName]: list.map((t) => (t.id === event.thread.id ? event.thread : t)),
          },
        });
        return;
      }
      case 'transcript.event': {
        // A finalized assistant event carries the full text; drop any queued
        // deltas for it so the pending flush cannot double-append.
        if (event.event.kind === 'assistant' && !event.event.streaming) {
          for (let i = deltaQueue.length - 1; i >= 0; i--) {
            if (deltaQueue[i]?.eventId === event.event.id) deltaQueue.splice(i, 1);
          }
        }
        const { transcripts } = get();
        const list = transcripts[event.event.sessionId] ?? [];
        const idx = list.findIndex((e) => e.id === event.event.id);
        const next = idx >= 0 ? list.map((e, i) => (i === idx ? event.event : e)) : [...list, event.event];
        set({ transcripts: { ...transcripts, [event.event.sessionId]: next } });
        return;
      }
      case 'transcript.delta': {
        deltaQueue.push({
          sessionId: event.sessionId,
          eventId: event.eventId,
          text: event.textDelta,
        });
        if (!deltaFlushScheduled) {
          deltaFlushScheduled = true;
          scheduleDeltaFlush(() => {
            deltaFlushScheduled = false;
            const batch = deltaQueue.splice(0);
            if (batch.length === 0) return;
            const { transcripts } = get();
            const bySession = new Map<string, Map<string, string>>();
            for (const d of batch) {
              const m = bySession.get(d.sessionId) ?? new Map<string, string>();
              m.set(d.eventId, (m.get(d.eventId) ?? '') + d.text);
              bySession.set(d.sessionId, m);
            }
            const nextTranscripts = { ...transcripts };
            for (const [sessionId, events] of bySession) {
              const list = nextTranscripts[sessionId] ?? [];
              nextTranscripts[sessionId] = list.map((e) => {
                const add = events.get(e.id);
                if (add !== undefined && e.kind === 'assistant') {
                  return { ...e, text: e.text + add, streaming: true };
                }
                return e;
              });
            }
            set({ transcripts: nextTranscripts });
          });
        }
        return;
      }
      case 'run.state':
        set({ runStates: { ...get().runStates, [event.sessionId]: event.runState } });
        return;
      case 'prompt.delivery': {
        const { transcripts } = get();
        const list = transcripts[event.sessionId] ?? [];
        set({
          transcripts: {
            ...transcripts,
            [event.sessionId]: list.map((e) =>
              e.kind === 'user' && e.requestId === event.requestId
                ? { ...e, delivery: event.delivery }
                : e,
            ),
          },
        });
        return;
      }
      case 'session.created': {
        const list = get().threads[event.thread.profileName] ?? [];
        set({
          threads: {
            ...get().threads,
            [event.thread.profileName]: [event.thread, ...list.filter((t) => t.id !== event.thread.id)],
          },
        });
        const route = get().route;
        if (route.view === 'chat' && route.profile === event.thread.profileName && route.sessionId === null) {
          set({ route: { view: 'chat', profile: route.profile, sessionId: event.thread.id } });
        }
        return;
      }
      case 'gateway.status':
        return; // handled via bot.updated
    }
  },

  async loadThreads(profile) {
    try {
      const threads = await unwrap(api().threads.list(profile));
      set({ threads: { ...get().threads, [profile]: threads } });
    } catch (err) {
      get().reportError(err, 'Could not load threads');
    }
  },

  async openSession(profile, sessionId) {
    try {
      const events = await unwrap(api().threads.history(profile, sessionId));
      set({ transcripts: { ...get().transcripts, [sessionId]: events } });
    } catch (err) {
      get().reportError(err, 'Could not load the conversation');
    }
  },

  setDraft(key, text) {
    set({ drafts: { ...get().drafts, [key]: text } });
    scheduleDraftPersist(key, text);
  },

  setThreadFilter(f) {
    set({ threadFilter: f });
  },

  setThreadSearch(q) {
    set({ threadSearch: q });
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },

  toast(title, message, error) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, title, message, error }] });
    setTimeout(() => get().dismissToast(id), error ? 8000 : 4500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  reportError(err, fallback) {
    const pub: PublicError | null = err instanceof ApiError ? err.publicError : null;
    get().toast(pub?.title ?? fallback, pub?.message ?? String((err as Error)?.message ?? ''), true);
  },

  async setPrefs(prefs) {
    set({ prefs });
    try {
      await unwrap(api().prefs.set(prefs));
    } catch (err) {
      get().reportError(err, 'Could not save preferences');
    }
  },
}));

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleDraftPersist(key: string, text: string): void {
  const existing = draftTimers.get(key);
  if (existing) clearTimeout(existing);
  draftTimers.set(
    key,
    setTimeout(() => {
      draftTimers.delete(key);
      void api().drafts.set(key, text);
    }, 600),
  );
}

export function draftKey(profile: string, sessionId: string | null): string {
  return `${profile}:${sessionId ?? 'new'}`;
}
