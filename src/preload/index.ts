/**
 * Preload bridge. Exposes only the enumerated HermesApi via contextBridge;
 * raw ipcRenderer is never attached to window (spec §11.2/§11.3).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { HermesApi } from './api-types';
import type { PushEnvelope } from '@shared/contracts';

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const api: HermesApi = {
  connection: {
    get: () => invoke('connection.get'),
    connect: (config) => invoke('connection.connect', config),
    reconnect: () => invoke('connection.reconnect'),
    sync: () => invoke('connection.sync'),
    disconnect: () => invoke('connection.disconnect'),
    confirmHostKey: (accept) => invoke('connection.confirmHostKey', { accept }),
    test: () => invoke('connection.test'),
    diagnostics: () => invoke('connection.diagnostics'),
    copyDiagnostics: () => invoke('connection.copyDiagnostics'),
  },
  prefs: {
    get: () => invoke('prefs.get'),
    set: (prefs) => invoke('prefs.set', prefs),
  },
  route: {
    get: () => invoke('route.get'),
    set: (route) => invoke('route.set', { route }),
  },
  drafts: {
    get: (key) => invoke('draft.get', { key }),
    set: (key, text) => invoke('draft.set', { key, text }),
  },
  privacy: {
    clearLocal: () => invoke('privacy.clearLocal'),
  },
  external: {
    open: (url) => invoke('external.open', { url }),
  },
  bots: {
    list: () => invoke('bots.list'),
    refresh: () => invoke('bots.refresh'),
    create: (input) => invoke('bots.create', input),
    delete: (profileName, confirmation) => invoke('bots.delete', { profileName, confirmation }),
    rename: (profileName, newName) => invoke('bots.rename', { profileName, newName }),
    setDescription: (profileName, description) =>
      invoke('bots.setDescription', { profileName, description }),
    setOrb: (input) => invoke('bots.setOrb', input),
    getConfig: (profileName) => invoke('bots.getConfig', { profileName }),
    setSoul: (profileName, content) => invoke('bots.setSoul', { profileName, content }),
    setModel: (profileName, provider, model) =>
      invoke('bots.setModel', { profileName, provider, model }),
  },
  avatar: {
    pick: () => invoke('avatar.pick'),
    set: (profileName, dataUri) => invoke('avatar.set', { profileName, dataUri }),
    clear: (profileName) => invoke('avatar.clear', { profileName }),
  },
  threads: {
    list: (profileName) => invoke('threads.list', { profileName }),
    search: (profileName, query) => invoke('threads.search', { profileName, query }),
    history: (profileName, sessionId) => invoke('threads.history', { profileName, sessionId }),
    rename: (sessionId, title) => invoke('threads.rename', { sessionId, title }),
    archive: (sessionId, archived) => invoke('threads.archive', { sessionId, archived }),
    delete: (sessionId) => invoke('threads.delete', { sessionId }),
    branch: (sessionId) => invoke('threads.branch', { sessionId }),
  },
  chat: {
    submit: (input) => invoke('chat.submit', input),
    interrupt: (sessionId) => invoke('chat.interrupt', { sessionId }),
    retry: (requestId) => invoke('chat.retry', { requestId }),
    transcript: (sessionId) => invoke('chat.transcript', { sessionId }),
  },
  approvals: {
    respondApproval: (sessionId, requestId, approve) =>
      invoke('approval.respond', { sessionId, requestId, approve }),
    respondClarify: (sessionId, requestId, answer) =>
      invoke('clarify.respond', { sessionId, requestId, answer }),
    respondSudo: (sessionId, requestId, password) =>
      invoke('sudo.respond', { sessionId, requestId, password }),
    respondSecret: (sessionId, requestId, value, cancelled) =>
      invoke('secret.respond', { sessionId, requestId, value, cancelled }),
  },
  telegram: {
    status: (profileName) => invoke('telegram.status', { profileName }),
    configure: (input) => invoke('telegram.configure', input),
    test: (profileName) => invoke('telegram.test', { profileName }),
    gateway: (profileName, action) => invoke('gateway.action', { profileName, action }),
  },
  personas: {
    index: () => invoke('personas.index'),
    soul: (id) => invoke('personas.soul', { id }),
  },
  logs: {
    get: (profileName) => invoke('logs.get', { profileName }),
  },
  app: {
    version: () => invoke('app.version'),
  },
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, envelope: unknown): void => {
      // Validate the envelope shape before it reaches app code (spec §14).
      if (
        envelope &&
        typeof envelope === 'object' &&
        (envelope as PushEnvelope).v === 1 &&
        typeof (envelope as PushEnvelope).event === 'object'
      ) {
        listener(envelope as PushEnvelope);
      }
    };
    ipcRenderer.on('hermes:event', wrapped);
    return () => ipcRenderer.removeListener('hermes:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('hermes', api);
