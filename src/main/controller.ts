/**
 * AppController — owns connection lifecycle, Hermes clients, normalized
 * caches, and the single push-event stream to the renderer (spec §14).
 */
import { Notification, webContents, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { SshTunnelManager, type TunnelConfig } from './connection/ssh-tunnel-manager';
import {
  isHostKnown,
  scanHostKey,
  trustHostKey,
  type ScannedHostKey,
} from './connection/host-key-policy';
import { DashboardClient, type RestSession } from './hermes/dashboard-client';
import { TuiGatewayClient } from './hermes/tui-gateway-client';
import { detectCapabilities, defaultCapabilities } from './hermes/capability-adapter';
import {
  normalizeFrame,
  normalizeHistoryMessage,
  type NormalizerContext,
} from './hermes/event-normalizer';
import { SettingsStore, type StoredConnection } from './storage/settings-store';
import { pickAvatar, saveAvatar, clearAvatar, loadAvatar, clearAvatarCache } from './avatars';
import { registerSecret, redact } from './logging/redaction';
import { log, recordDiagnostic, buildDiagnosticsReport, getLogLines } from './logging/logger';
import { AppError, publicError, toPublicError, type PublicError } from '@shared/errors';
import { APP_NAME } from '@shared/branding';
import { displayNameFor } from '@shared/display-names';
import { AVATAR_PALETTES } from '@shared/avatar';
import type {
  BotSummary,
  Capabilities,
  ConnectionSummary,
  HostTrustPrompt,
  PushEvent,
  TelegramStatus,
  ThreadSummary,
  TranscriptEvent,
  UserMessageEvent,
  PromptDeliveryState,
  RunState,
  CreateBotResult,
  CreateBotStepResult,
  OrbDefinition,
  LogLine,
  ModelOptions,
} from '@shared/contracts';
import type { ConnectConfigInput } from '@shared/schemas';

const HEALTH_INTERVAL_MS = 30_000;

interface PendingPrompt {
  requestId: string;
  profileName: string;
  sessionId: string;
  text: string;
  state: PromptDeliveryState;
  at: number;
}

export class AppController {
  readonly settings = new SettingsStore();
  private readonly tunnel = new SshTunnelManager();
  private readonly rest = new DashboardClient(() => this.tunnel.localPort);
  private readonly ws = new TuiGatewayClient(
    () => this.tunnel.localPort,
    () => this.rest.getSessionToken(),
  );

  private window: BrowserWindow | null = null;
  private connectionId = randomUUID();
  private hermesVersion: string | undefined;
  private latencyMs: number | undefined;
  private lastCheckedAt: string | undefined;
  private lastError: PublicError | undefined;
  private capabilities: Capabilities = defaultCapabilities();
  private serverFingerprint = 'unknown-server';
  private pendingTrust: ScannedHostKey | null = null;
  private trustPromptInfo: HostTrustPrompt | null = null;
  private healthTimer: NodeJS.Timeout | null = null;

  private bots = new Map<string, BotSummary>();
  private threads = new Map<string, ThreadSummary[]>();
  private transcripts = new Map<string, TranscriptEvent[]>();
  private sessionProfile = new Map<string, string>();
  /**
   * Hermes uses two ids per conversation: the durable one REST reports (e.g.
   * `20260820_174503_01c16a`) and a short in-memory gateway handle minted on
   * create/resume (e.g. `04b7e762`). The app keys everything by the durable
   * id and translates only when talking to the WebSocket.
   */
  private gatewayIdByStored = new Map<string, string>();
  private storedIdByGateway = new Map<string, string>();
  private activeSessionId: string | null = null;
  private pendingPrompts = new Map<string, PendingPrompt>();
  /** Approvals / prompts already answered — exactly-once guard (spec §6.6). */
  private answeredRequests = new Set<string>();
  private streamBuffers = new Map<string, { eventId: string; text: string }>();

  constructor() {
    this.tunnel.on('state', () => this.pushConnection());
    this.tunnel.on('ready', () => void this.onTunnelReady());
    this.tunnel.on('failure', (kind, diagnosticId) => this.onTunnelFailure(kind, diagnosticId));
    this.ws.on('open', () => void this.onGatewayOpen());
    this.ws.on('close', () => this.onGatewayClose());
    this.ws.on('event', (raw) => this.onGatewayEvent(raw));
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win;
  }

  // -------------------------------------------------------------------------
  // Push channel

  private push(event: PushEvent): void {
    const payload = { v: 1 as const, event };
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send('hermes:event', payload);
    }
  }

  private pushConnection(): void {
    this.push({ type: 'connection.state', connection: this.connectionSummary() });
  }

  /**
   * Re-push the current state. The renderer calls this at the end of boot so
   * any push events emitted while it was still loading are healed rather
   * than lost (main connects in parallel with renderer startup).
   */
  async pushFullState(): Promise<void> {
    this.pushConnection();
    this.push({ type: 'capabilities', capabilities: this.capabilities });
    if (this.tunnel.status === 'online' && this.bots.size === 0) {
      try {
        await this.refreshBots();
        return; // refreshBots already pushed bots.updated
      } catch {
        /* not reachable yet; the health loop will recover */
      }
    }
    this.push({ type: 'bots.updated', bots: [...this.bots.values()] });
  }

  connectionSummary(): ConnectionSummary {
    const stored = this.settings.connection;
    return {
      id: this.connectionId,
      label: stored?.label ?? 'Hermes VPS',
      host: stored?.host ?? '',
      port: stored?.port ?? 22,
      user: stored?.user ?? '',
      status: this.tunnel.status,
      hermesVersion: this.hermesVersion,
      latencyMs: this.latencyMs,
      localPort: this.tunnel.localPort ?? undefined,
      tunnelUptimeSec: this.tunnel.uptimeSec,
      retryCount: this.tunnel.retryCount,
      hostFingerprint: stored?.lastFingerprint,
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
    };
  }

  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle

  async connect(config: ConnectConfigInput): Promise<void> {
    this.lastError = undefined;
    const stored: StoredConnection = {
      id: this.connectionId,
      label: config.label,
      host: config.host,
      port: config.port,
      user: config.user,
      authMethod: config.authMethod,
      keyPath: config.keyPath,
      sshConfigHost: config.sshConfigHost,
      remotePort: config.remotePort,
      lastFingerprint: this.settings.connection?.lastFingerprint,
    };
    this.settings.setConnection(stored);
    await this.startConnection();
  }

  async reconnect(): Promise<void> {
    await this.startConnection();
  }

  private async startConnection(): Promise<void> {
    const stored = this.settings.connection;
    if (!stored) {
      throw new AppError(
        publicError('app/internal', 'No connection configured', 'Set up the SSH connection first.', false),
      );
    }
    await this.tunnel.stop();
    this.lastError = undefined;

    // Host trust check before any tunnel attempt (spec §6.1 step 6–7).
    const target =
      stored.authMethod === 'ssh-config-host' && stored.sshConfigHost
        ? null // ssh config aliases resolve inside OpenSSH; rely on its known_hosts flow
        : { host: stored.host, port: stored.port };
    if (target) {
      const known = await isHostKnown(target.host, target.port);
      if (!known) {
        const scanned = await scanHostKey(target.host, target.port);
        if (!scanned) {
          this.lastError = publicError(
            'ssh/unreachable',
            'Host unreachable',
            'Could not reach the SSH host to read its key. Check the address and network.',
            true,
          );
          this.pushConnection();
          return;
        }
        this.pendingTrust = scanned;
        this.trustPromptInfo = {
          host: target.host,
          port: target.port,
          fingerprint: scanned.fingerprint,
          keyType: scanned.keyType,
        };
        this.push({ type: 'connection.trust-prompt', prompt: this.trustPromptInfo });
        return; // wait for confirmHostKey
      }
    }
    await this.tunnel.start(this.tunnelConfig(stored));
  }

  private tunnelConfig(stored: StoredConnection): TunnelConfig {
    return {
      host: stored.host,
      port: stored.port,
      user: stored.user,
      authMethod: stored.authMethod,
      keyPath: stored.keyPath,
      sshConfigHost: stored.sshConfigHost,
      remotePort: stored.remotePort,
    };
  }

  getTrustPrompt(): HostTrustPrompt | null {
    return this.trustPromptInfo;
  }

  async confirmHostKey(accept: boolean): Promise<void> {
    const scanned = this.pendingTrust;
    this.pendingTrust = null;
    this.trustPromptInfo = null;
    if (!accept || !scanned) {
      log.info('host-key', 'user declined host key');
      this.pushConnection();
      return;
    }
    await trustHostKey(scanned);
    const stored = this.settings.connection;
    if (stored) {
      stored.lastFingerprint = scanned.fingerprint;
      this.settings.setConnection(stored);
    }
    await this.tunnel.start(this.tunnelConfig(this.settings.connection!));
  }

  async disconnect(): Promise<void> {
    this.ws.disconnect();
    this.rest.clearSessionToken();
    // Avatars are keyed by server fingerprint; drop the cache so a different
    // server never shows the previous one's pictures.
    clearAvatarCache();
    await this.tunnel.stop();
    this.stopHealthTimer();
    this.pushConnection();
  }

  private onTunnelFailure(kind: string, diagnosticId: string): void {
    const map: Record<string, PublicError> = {
      'unknown-host': publicError(
        'ssh/unknown-host',
        'Unknown SSH host',
        'The server host key is not yet trusted. Reconnect to review its fingerprint.',
        true,
        diagnosticId,
      ),
      'host-key-changed': publicError(
        'ssh/host-key-changed',
        'Host key changed',
        'The server identity does not match what was previously trusted. Verify the server out-of-band before connecting; the app will not auto-accept the new key.',
        false,
        diagnosticId,
      ),
      'permission-denied': publicError(
        'ssh/permission-denied',
        'SSH authentication failed',
        'The SSH server rejected the configured authentication (agent/key). Check the key in Edit connection.',
        false,
        diagnosticId,
      ),
      'forward-prohibited': publicError(
        'ssh/forward-prohibited',
        'Forwarding not permitted',
        'The server refused the local forward. Its SSH policy may restrict PermitOpen; do not open public ports to work around this.',
        false,
        diagnosticId,
      ),
      unreachable: publicError(
        'ssh/unreachable',
        'Server unreachable',
        'The SSH server could not be reached. The app keeps retrying automatically.',
        true,
        diagnosticId,
      ),
    };
    this.lastError =
      map[kind] ??
      publicError('ssh/exited', 'SSH tunnel ended', 'The SSH tunnel exited unexpectedly. Reconnecting…', true, diagnosticId);
    this.pushConnection();
    if (this.settings.preferences.notifyConnectionFailures && !map[kind]?.retryable) {
      this.notify('Connection problem', this.lastError.message);
    }
  }

  private async onTunnelReady(): Promise<void> {
    this.tunnel.markChecking();
    this.pushConnection();
    try {
      const status = await this.rest.status();
      this.hermesVersion = status.version;
      this.latencyMs = status.latencyMs;
      this.lastCheckedAt = new Date().toISOString();
      // Loopback dashboards gate the API behind an ephemeral session token
      // served with the SPA shell; fetch it before touching gated routes.
      await this.rest.bootstrapSessionToken();
      this.tunnel.markOnline();
      this.lastError = undefined;
      this.serverFingerprint = this.settings.connection?.lastFingerprint ?? `${this.settings.connection?.host}`;
      this.pushConnection();

      await this.refreshBots();
      const firstProfile = [...this.bots.keys()][0];
      this.capabilities = await detectCapabilities(this.rest, this.hermesVersion, firstProfile);
      this.push({ type: 'capabilities', capabilities: this.capabilities });

      this.ws.connect();
      this.startHealthTimer();
    } catch (err) {
      this.lastError = toPublicError(err, 'Hermes unavailable');
      this.pushConnection();
      // Tunnel is up but Hermes did not answer — keep checking.
      this.startHealthTimer();
    }
  }

  private startHealthTimer(): void {
    this.stopHealthTimer();
    this.healthTimer = setInterval(() => void this.healthCheck(), HEALTH_INTERVAL_MS);
  }

  private stopHealthTimer(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  async healthCheck(): Promise<void> {
    if (!this.tunnel.localPort) return;
    try {
      const status = await this.rest.status();
      this.latencyMs = status.latencyMs;
      this.hermesVersion = status.version ?? this.hermesVersion;
      this.lastCheckedAt = new Date().toISOString();
      if (this.tunnel.status === 'checking-hermes') {
        this.tunnel.markOnline();
        this.ws.connect();
      }
      this.lastError = undefined;
      this.pushConnection();
    } catch (err) {
      this.lastError = toPublicError(err, 'Hermes health check failed');
      this.pushConnection();
    }
  }

  /** Sleep/wake and network changes trigger an immediate check (spec §9.1). */
  onSystemResume(): void {
    log.info('power', 'system resumed; probing connection');
    void this.healthCheck();
    this.tunnel.kick();
    this.ws.kick();
    void this.reconcilePendingPrompts();
  }

  // -------------------------------------------------------------------------
  // Bots / profiles

  private orbFromMetadata(profileName: string): { displayName: string; role?: string; orb: OrbDefinition } {
    const meta = this.settings.orbFor(this.serverFingerprint, profileName);
    return {
      displayName: displayNameFor(profileName, meta?.displayName),
      role: meta?.role,
      orb:
        meta?.orb ??
        // No stored look yet: seed off the profile name so the avatar is
        // stable and distinct without anyone choosing one.
        {
          paletteId: AVATAR_PALETTES[Math.abs(hashCode(profileName)) % AVATAR_PALETTES.length]!.id,
          seed: profileName,
        },
    };
  }

  async refreshBots(): Promise<BotSummary[]> {
    const profiles = await this.rest.listProfiles();
    const next = new Map<string, BotSummary>();
    for (const p of profiles) {
      const prev = this.bots.get(p.name);
      const meta = this.orbFromMetadata(p.name);
      next.set(p.name, {
        profileName: p.name,
        displayName: meta.displayName,
        role: meta.role,
        description: p.description,
        orb: meta.orb,
        avatarDataUri: loadAvatar(this.serverFingerprint, p.name),
        provider: p.provider,
        model: p.model,
        runState: prev?.runState ?? 'idle',
        gatewayState: prev?.gatewayState ?? 'disabled',
        unreadCount: prev?.unreadCount ?? 0,
        workingDir: p.working_dir,
      });
    }
    this.bots = next;
    const bots = [...next.values()];
    this.push({ type: 'bots.updated', bots });
    return bots;
  }

  listBots(): BotSummary[] {
    return [...this.bots.values()];
  }

  setOrbMetadata(profileName: string, entry: { displayName?: string; role?: string; orb?: OrbDefinition }): void {
    const existing = this.settings.orbFor(this.serverFingerprint, profileName) ?? {};
    this.settings.setOrb(this.serverFingerprint, profileName, { ...existing, ...entry });
    this.republishBot(profileName);
  }

  private republishBot(profileName: string): void {
    const bot = this.bots.get(profileName);
    if (!bot) return;
    const meta = this.orbFromMetadata(profileName);
    const updated: BotSummary = {
      ...bot,
      displayName: meta.displayName,
      role: meta.role,
      orb: meta.orb,
      avatarDataUri: loadAvatar(this.serverFingerprint, profileName),
    };
    this.bots.set(profileName, updated);
    this.push({ type: 'bot.updated', bot: updated });
  }

  // --- avatars -------------------------------------------------------------

  /** Opens the native picker in main; the renderer never supplies a path. */
  async pickAvatarImage(): Promise<string | null> {
    return await pickAvatar(this.window);
  }

  async setAvatar(profileName: string, dataUri: string): Promise<string> {
    const uri = await saveAvatar(this.serverFingerprint, profileName, dataUri);
    this.republishBot(profileName);
    return uri;
  }

  async removeAvatar(profileName: string): Promise<void> {
    await clearAvatar(this.serverFingerprint, profileName);
    this.republishBot(profileName);
  }

  async createBot(input: {
    name: string;
    displayName: string;
    role?: string;
    description?: string;
    orb: OrbDefinition;
    soul?: string;
    provider?: string;
    model?: string;
    cloneFrom?: string | null;
    keepSkills?: string[];
  }): Promise<CreateBotResult> {
    const steps: CreateBotStepResult[] = [];
    // Step 1: create the profile. Failure here is total failure.
    try {
      await this.rest.createProfile({
        name: input.name,
        clone_from: input.cloneFrom ?? undefined,
        description: input.description,
        provider: input.provider,
        model: input.model,
        keep_skills: input.keepSkills,
      });
      steps.push({ step: 'profile', ok: true });
    } catch (err) {
      steps.push({ step: 'profile', ok: false, error: toPublicError(err) });
      return { ok: false, steps };
    }

    // Local metadata is app-owned and cannot fail the wizard.
    this.setOrbMetadata(input.name, {
      displayName: input.displayName,
      role: input.role,
      orb: input.orb,
    });

    // Later steps: partial failure keeps the profile (spec §6.4 step 6).
    if (input.soul !== undefined && input.soul.trim() !== '') {
      try {
        await this.rest.setSoul(input.name, input.soul);
        steps.push({ step: 'soul', ok: true });
      } catch (err) {
        steps.push({ step: 'soul', ok: false, error: toPublicError(err) });
      }
    }
    if (input.model && input.provider) {
      try {
        await this.rest.setProfileModel(input.name, input.provider, input.model);
        steps.push({ step: 'model', ok: true });
      } catch (err) {
        steps.push({ step: 'model', ok: false, error: toPublicError(err) });
      }
    }

    await this.refreshBots();
    const ok = steps.every((s) => s.ok);
    return { ok, profileName: input.name, steps };
  }

  async deleteBot(profileName: string): Promise<void> {
    await this.rest.deleteProfile(profileName);
    this.bots.delete(profileName);
    this.threads.delete(profileName);
    // Local presentation data outlives Hermes state unless we clean it up.
    await clearAvatar(this.serverFingerprint, profileName);
    await this.refreshBots();
  }

  // -------------------------------------------------------------------------
  // Sessions / threads

  private toThread(s: RestSession, profileName: string): ThreadSummary {
    // v0.20.x reports epoch-seconds floats; fall back to ISO fields when a
    // future build supplies them instead.
    const epoch = s.ended_at ?? s.started_at;
    const updatedAt =
      s.updated_at ??
      (epoch !== undefined ? new Date(epoch * 1000).toISOString() : undefined) ??
      s.created_at ??
      new Date().toISOString();
    return {
      id: s.id,
      profileName: s.profile ?? profileName,
      title: s.title?.trim() || 'Untitled thread',
      preview: s.preview,
      updatedAt,
      state: s.archived ? 'archived' : s.active ? 'active' : 'idle',
      unread: false,
    };
  }

  async refreshThreads(profileName: string): Promise<ThreadSummary[]> {
    // `/api/sessions?profile=` scopes correctly; the sidebar endpoint accepts
    // the parameter but ignores it and always answers with the launch
    // profile's recents, which showed every bot the same history. Each row
    // carries its own `profile`, so filter on that as well rather than
    // trusting the endpoint.
    const sessions = (await this.rest.listSessions(profileName)).filter(
      (s) => !s.profile || s.profile === profileName,
    );
    const threads = sessions.map((s) => this.toThread(s, profileName));
    threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    this.threads.set(profileName, threads);
    for (const t of threads) this.sessionProfile.set(t.id, t.profileName);
    this.push({ type: 'threads.updated', profileName, threads });
    return threads;
  }

  async searchThreads(query: string, profileName: string): Promise<ThreadSummary[]> {
    const sessions = await this.rest.searchSessions(query, profileName);
    // Same guard as refreshThreads: never show another profile's threads even
    // if an endpoint forgets to scope.
    return sessions
      .filter((s) => !s.profile || s.profile === profileName)
      .map((s) => this.toThread(s, profileName));
  }

  async loadHistory(profileName: string, sessionId: string): Promise<TranscriptEvent[]> {
    const raw = await this.rest.getMessages(sessionId);
    const ctx: NormalizerContext = { profileName, sessionId };
    const events = raw.flatMap((m, i) => normalizeHistoryMessage(m, ctx, i));
    this.transcripts.set(sessionId, events);
    this.sessionProfile.set(sessionId, profileName);
    return events;
  }

  /**
   * Make a thread the gateway's live session.
   *
   * `session.activate` only works for sessions the gateway already holds in
   * memory; a thread restored from history has to be resumed off disk first,
   * or every later prompt.submit fails with "session not found". We pass
   * `omit_messages` because the transcript is hydrated over REST in parallel —
   * the gateway would otherwise replay the whole conversation at us.
   */
  async activateSession(profileName: string, sessionId: string): Promise<void> {
    this.activeSessionId = sessionId;
    this.sessionProfile.set(sessionId, profileName);
    if (!this.ws.connected) return;

    const live = await this.liveSessionIds();
    const known = this.gatewayIdByStored.get(sessionId);
    const alreadyLive = (known && live.has(known)) || live.has(sessionId);
    try {
      if (alreadyLive) {
        const handle = known && live.has(known) ? known : sessionId;
        await this.ws.call('session.activate', { session_id: handle, profile: profileName });
        this.bindSessionIds(sessionId, handle);
      } else {
        // Resuming mints a fresh gateway handle for the stored conversation;
        // everything afterwards must address that handle, not the stored id.
        const result = await this.ws.call<Record<string, unknown>>('session.resume', {
          session_id: sessionId,
          profile: profileName,
          omit_messages: true,
        });
        const handle = result && typeof result === 'object' ? result.session_id : undefined;
        this.bindSessionIds(sessionId, handle ? String(handle) : undefined);
      }
    } catch (err) {
      log.warn('ws', `activating session failed: ${toPublicError(err).message}`);
    }
  }

  private bindSessionIds(storedId: string, gatewayId: string | undefined): void {
    if (!gatewayId) return;
    this.gatewayIdByStored.set(storedId, gatewayId);
    this.storedIdByGateway.set(gatewayId, storedId);
  }

  /** Translate a durable session id to the handle the gateway expects. */
  private wsId(storedId: string): string {
    return this.gatewayIdByStored.get(storedId) ?? storedId;
  }

  /** Translate an id seen on the wire back to the durable one the UI uses. */
  private storedId(anyId: string): string {
    return this.storedIdByGateway.get(anyId) ?? anyId;
  }

  /** Ids the gateway currently holds in memory (tolerant of response shape). */
  private async liveSessionIds(): Promise<Set<string>> {
    try {
      const result = await this.ws.call<unknown>('session.active_list', {});
      const rows = Array.isArray(result)
        ? result
        : result && typeof result === 'object'
          ? ((result as { sessions?: unknown[] }).sessions ?? [])
          : [];
      const ids = new Set<string>();
      for (const row of rows) {
        if (typeof row === 'string') ids.add(row);
        else if (row && typeof row === 'object') {
          const id = (row as Record<string, unknown>).session_id ?? (row as Record<string, unknown>).id;
          if (id !== undefined && id !== null) ids.add(String(id));
        }
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.rest.renameSession(sessionId, title);
    const profileName = this.sessionProfile.get(sessionId);
    if (profileName) await this.refreshThreads(profileName);
  }

  async archiveSession(sessionId: string, archived: boolean): Promise<void> {
    await this.rest.archiveSession(sessionId, archived);
    const profileName = this.sessionProfile.get(sessionId);
    if (profileName) await this.refreshThreads(profileName);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const profileName = this.sessionProfile.get(sessionId);
    // Prefer the gateway RPC (it knows about live sessions and refuses to
    // delete one mid-run); fall back to REST on older builds.
    // Hermes refuses to delete a session the gateway still holds open, so
    // release the handle first; deletion then targets the durable row.
    const handleToClose = this.gatewayIdByStored.get(sessionId);
    if (handleToClose) {
      try {
        await this.ws.call('session.close', { session_id: handleToClose });
      } catch {
        /* already closed or unsupported — deletion below still reports truth */
      }
    }
    try {
      await this.ws.call('session.delete', { session_id: sessionId, profile: profileName });
    } catch {
      await this.rest.deleteSession(sessionId);
    }
    this.transcripts.delete(sessionId);
    this.sessionProfile.delete(sessionId);
    const handle = this.gatewayIdByStored.get(sessionId);
    if (handle) this.storedIdByGateway.delete(handle);
    this.gatewayIdByStored.delete(sessionId);
    if (profileName) await this.refreshThreads(profileName);
  }

  async branchSession(sessionId: string): Promise<string | null> {
    const result = await this.ws.call<Record<string, unknown>>('session.branch', {
      session_id: this.wsId(sessionId),
    });
    const newId = result && typeof result === 'object' ? String(result.session_id ?? result.id ?? '') : '';
    const profileName = this.sessionProfile.get(sessionId);
    if (profileName) await this.refreshThreads(profileName);
    return newId || null;
  }

  // -------------------------------------------------------------------------
  // Prompt lifecycle (spec §9.2)

  async submitPrompt(input: {
    profileName: string;
    sessionId: string | null;
    requestId: string;
    text: string;
    mode: 'normal' | 'steer' | 'background';
  }): Promise<{ sessionId: string }> {
    let sessionId = input.sessionId;

    if (!sessionId) {
      const created = await this.ws.call<Record<string, unknown>>('session.create', {
        profile: input.profileName,
      });
      const gatewayId = String(created?.session_id ?? created?.id ?? '');
      // Prefer the durable id so the thread keeps working after a restart;
      // fall back to the gateway handle on builds that omit it.
      sessionId = String(created?.stored_session_id ?? '') || gatewayId;
      if (!sessionId) {
        throw new AppError(
          publicError('hermes/schema-mismatch', 'Session not created', 'Hermes did not return a session id.', true),
        );
      }
      this.bindSessionIds(sessionId, gatewayId || sessionId);
      this.sessionProfile.set(sessionId, input.profileName);
      this.activeSessionId = sessionId;
      const thread: ThreadSummary = {
        id: sessionId,
        profileName: input.profileName,
        title: input.text.slice(0, 60),
        preview: input.text.slice(0, 120),
        updatedAt: new Date().toISOString(),
        state: 'active',
        unread: false,
      };
      const list = this.threads.get(input.profileName) ?? [];
      this.threads.set(input.profileName, [thread, ...list]);
      this.push({ type: 'session.created', provisionalId: input.requestId, thread });
    }

    const pending: PendingPrompt = {
      requestId: input.requestId,
      profileName: input.profileName,
      sessionId,
      text: input.text,
      state: 'submitting',
      at: Date.now(),
    };
    this.pendingPrompts.set(input.requestId, pending);

    const userEvent: UserMessageEvent = {
      id: `user-${input.requestId}`,
      sessionId,
      profileName: input.profileName,
      at: new Date().toISOString(),
      kind: 'user',
      text: input.text,
      requestId: input.requestId,
      delivery: 'submitting',
      steered: input.mode === 'steer',
    };
    this.appendTranscript(userEvent);

    // v0.20.x: a prompt.submit during an active run steers/queues server-side
    // (there is no separate session.steer method); background uses its own.
    const method = input.mode === 'background' ? 'prompt.background' : 'prompt.submit';
    try {
      await this.ws.call(method, {
        session_id: this.wsId(sessionId),
        profile: input.profileName,
        request_id: input.requestId,
        text: input.text,
      });
      pending.state = 'acknowledged';
      this.push({ type: 'prompt.delivery', sessionId, requestId: input.requestId, delivery: 'acknowledged' });
      this.push({ type: 'run.state', sessionId, runState: 'thinking' });
    } catch (err) {
      const pub = toPublicError(err);
      pending.state = pub.code === 'ws/disconnected' ? 'delivery-unknown' : 'failed';
      this.push({
        type: 'prompt.delivery',
        sessionId,
        requestId: input.requestId,
        delivery: pending.state,
      });
      if (pending.state === 'failed') this.pendingPrompts.delete(input.requestId);
      throw err;
    }
    return { sessionId };
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.ws.call('session.interrupt', { session_id: this.wsId(sessionId) });
  }

  /**
   * Delivery-unknown reconciliation (spec §9.2): after reconnect, check
   * history for each unacknowledged prompt; never auto-resubmit.
   */
  private async reconcilePendingPrompts(): Promise<void> {
    for (const pending of [...this.pendingPrompts.values()]) {
      if (pending.state !== 'delivery-unknown' && pending.state !== 'submitting') continue;
      try {
        const raw = await this.rest.getMessages(pending.sessionId);
        const found = raw.some((m) => {
          if (!m || typeof m !== 'object') return false;
          const mm = m as Record<string, unknown>;
          return (
            mm.request_id === pending.requestId ||
            (typeof mm.content === 'string' && mm.content === pending.text)
          );
        });
        const delivery: PromptDeliveryState = found ? 'complete' : 'delivery-unknown';
        if (found) this.pendingPrompts.delete(pending.requestId);
        this.push({
          type: 'prompt.delivery',
          sessionId: pending.sessionId,
          requestId: pending.requestId,
          delivery,
        });
      } catch {
        // Leave as delivery-unknown; the renderer offers manual retry.
      }
    }
  }

  /** Renderer-initiated retry for a prompt confirmed absent from history. */
  async retryPrompt(requestId: string): Promise<void> {
    const pending = this.pendingPrompts.get(requestId);
    if (!pending) return;
    this.pendingPrompts.delete(requestId);
    await this.submitPrompt({
      profileName: pending.profileName,
      sessionId: pending.sessionId,
      requestId: randomUUID(),
      text: pending.text,
      mode: 'normal',
    });
  }

  // -------------------------------------------------------------------------
  // Approvals and input requests (exactly once, spec §6.6)

  private assertNotAnswered(requestId: string): void {
    if (this.answeredRequests.has(requestId)) {
      throw new AppError(
        publicError('approval/expired', 'Already answered', 'This request was already answered.', false),
      );
    }
    this.answeredRequests.add(requestId);
    if (this.answeredRequests.size > 2000) {
      this.answeredRequests = new Set([...this.answeredRequests].slice(-1000));
    }
  }

  async respondApproval(sessionId: string, requestId: string, approve: boolean): Promise<void> {
    this.assertNotAnswered(requestId);
    // v0.20.x contract: choice is one of the payload's `choices`
    // ("once"/"session"/"always"/"deny"); we only ever grant once.
    await this.ws.call('approval.respond', {
      session_id: this.wsId(sessionId),
      request_id: requestId,
      choice: approve ? 'once' : 'deny',
    });
    this.markDecision(sessionId, requestId, approve ? 'approved' : 'denied');
  }

  async respondClarify(sessionId: string, requestId: string, answer: string): Promise<void> {
    this.assertNotAnswered(requestId);
    await this.ws.call('clarify.respond', {
      session_id: this.wsId(sessionId),
      request_id: requestId,
      answer,
    });
    this.markDecision(sessionId, requestId, 'answered');
  }

  /** v0.20.x contract: sudo.respond carries the password; empty cancels. */
  async respondSudo(sessionId: string, requestId: string, password: string): Promise<void> {
    this.assertNotAnswered(requestId);
    if (password) registerSecret(password); // never allow it into logs
    await this.ws.call('sudo.respond', {
      session_id: this.wsId(sessionId),
      request_id: requestId,
      password,
    });
    this.markDecision(sessionId, requestId, password ? 'answered' : 'denied');
  }

  async respondSecret(sessionId: string, requestId: string, value: string, cancelled: boolean): Promise<void> {
    this.assertNotAnswered(requestId);
    if (!cancelled && value) registerSecret(value); // never allow it into logs
    // v0.20.x contract: {request_id, value}; empty value cancels.
    await this.ws.call('secret.respond', {
      session_id: this.wsId(sessionId),
      request_id: requestId,
      value: cancelled ? '' : value,
    });
    this.markDecision(sessionId, requestId, cancelled ? 'denied' : 'answered');
  }

  private markDecision(
    sessionId: string,
    requestId: string,
    decision: 'approved' | 'denied' | 'answered' | 'expired',
  ): void {
    const events = this.transcripts.get(sessionId);
    if (!events) return;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (
        (e.kind === 'approval' || e.kind === 'clarify' || e.kind === 'sudo' || e.kind === 'secret') &&
        e.requestId === requestId
      ) {
        const updated = { ...e, decision };
        events[i] = updated as TranscriptEvent;
        this.push({ type: 'transcript.event', event: updated as TranscriptEvent });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Gateway (WS) event handling

  private async onGatewayOpen(): Promise<void> {
    this.pushConnection();
    await this.reconcilePendingPrompts();
    if (this.activeSessionId) {
      const profileName = this.sessionProfile.get(this.activeSessionId);
      // Re-bind the visible thread after a reconnect; the gateway may have
      // dropped it from memory while we were away.
      if (profileName) await this.activateSession(profileName, this.activeSessionId);
    }
  }

  private onGatewayClose(): void {
    // Prompts sent but not acknowledged become delivery-unknown (spec §9.2).
    for (const pending of this.pendingPrompts.values()) {
      if (pending.state === 'submitting') {
        pending.state = 'delivery-unknown';
        this.push({
          type: 'prompt.delivery',
          sessionId: pending.sessionId,
          requestId: pending.requestId,
          delivery: 'delivery-unknown',
        });
      }
    }
    if (this.activeSessionId) {
      this.push({ type: 'run.state', sessionId: this.activeSessionId, runState: 'disconnected' });
    }
  }

  private onGatewayEvent(raw: Record<string, unknown>): void {
    const normalized = normalizeFrame(raw, (sessionId) => {
      // Frames carry the gateway handle; translate to the durable id the
      // renderer's transcripts and threads are keyed by.
      const sid = sessionId ? this.storedId(sessionId) : this.activeSessionId;
      if (!sid) return null;
      const profileName = this.sessionProfile.get(sid) ?? this.activeProfileFallback();
      if (!profileName) return null;
      return { profileName, sessionId: sid };
    });

    switch (normalized.kind) {
      case 'ignored':
        return;
      case 'transcript': {
        this.appendTranscript(normalized.event);
        if (normalized.event.kind === 'approval' || normalized.event.kind === 'sudo') {
          this.push({ type: 'run.state', sessionId: normalized.event.sessionId, runState: 'waiting-approval' });
          if (this.settings.preferences.notifyApprovals && !this.window?.isFocused()) {
            this.notify(`${APP_NAME}: approval needed`, redact(
              normalized.event.kind === 'approval'
                ? normalized.event.summary
                : normalized.event.commandSummary,
            ));
          }
        } else if (normalized.event.kind === 'tool' && normalized.event.status === 'running') {
          this.push({ type: 'run.state', sessionId: normalized.event.sessionId, runState: 'tool-running' });
        }
        return;
      }
      case 'delta': {
        const buf = this.streamBuffers.get(normalized.sessionId);
        const eventId = `assistant-${normalized.messageId}`;
        if (!buf || buf.eventId !== eventId) {
          this.streamBuffers.set(normalized.sessionId, { eventId, text: normalized.textDelta });
          const profileName = this.sessionProfile.get(normalized.sessionId) ?? '';
          // Push the event empty; the delta below carries the first chunk, so
          // the renderer never applies the same text twice.
          this.appendTranscript({
            id: eventId,
            sessionId: normalized.sessionId,
            profileName,
            at: new Date().toISOString(),
            kind: 'assistant',
            text: '',
            streaming: true,
          });
          this.updateStoredAssistant(normalized.sessionId, eventId, normalized.textDelta, true);
        } else {
          buf.text += normalized.textDelta;
          this.updateStoredAssistant(normalized.sessionId, eventId, buf.text, true);
        }
        this.push({
          type: 'transcript.delta',
          sessionId: normalized.sessionId,
          eventId,
          textDelta: normalized.textDelta,
        });
        this.push({ type: 'run.state', sessionId: normalized.sessionId, runState: 'thinking' });
        return;
      }
      case 'message-complete': {
        const eventId = `assistant-${normalized.messageId}`;
        const buf = this.streamBuffers.get(normalized.sessionId);
        const text = normalized.fullText ?? buf?.text ?? '';
        this.streamBuffers.delete(normalized.sessionId);
        this.updateStoredAssistant(normalized.sessionId, eventId, text, false);
        const profileName = this.sessionProfile.get(normalized.sessionId) ?? '';
        this.push({
          type: 'transcript.event',
          event: {
            id: eventId,
            sessionId: normalized.sessionId,
            profileName,
            at: new Date().toISOString(),
            kind: 'assistant',
            text: redact(text),
            streaming: false,
          },
        });
        this.push({ type: 'run.state', sessionId: normalized.sessionId, runState: 'ready' });
        if (this.settings.preferences.notifyCompletedRuns && !this.window?.isFocused()) {
          const bot = this.bots.get(profileName);
          this.notify(`${bot?.displayName ?? profileName} finished`, text.slice(0, 120));
        }
        return;
      }
      case 'ack': {
        const pending = this.pendingPrompts.get(normalized.requestId);
        if (pending) {
          pending.state = 'acknowledged';
          this.push({
            type: 'prompt.delivery',
            sessionId: normalized.sessionId,
            requestId: normalized.requestId,
            delivery: 'acknowledged',
          });
        }
        return;
      }
      case 'run-state': {
        this.push({ type: 'run.state', sessionId: normalized.sessionId, runState: normalized.state });
        return;
      }
      case 'expire': {
        this.markDecision(normalized.sessionId, normalized.requestId, 'expired');
        this.answeredRequests.add(normalized.requestId); // late responses must never send
        return;
      }
      case 'session-update': {
        const profileName = this.sessionProfile.get(normalized.sessionId);
        if (profileName) void this.refreshThreads(profileName);
        return;
      }
    }
  }

  private activeProfileFallback(): string | null {
    if (this.activeSessionId) {
      const p = this.sessionProfile.get(this.activeSessionId);
      if (p) return p;
    }
    return [...this.bots.keys()][0] ?? null;
  }

  private appendTranscript(event: TranscriptEvent): void {
    const list = this.transcripts.get(event.sessionId) ?? [];
    // Replace by id (tool progress updates reuse the id).
    const idx = list.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      const prev = list[idx]!;
      const merged = { ...prev, ...event } as TranscriptEvent;
      list[idx] = merged;
      this.transcripts.set(event.sessionId, list);
      this.push({ type: 'transcript.event', event: merged });
      return;
    }
    list.push(event);
    // Bounded cache: keep the most recent 1500 completed events per session.
    if (list.length > 1500) list.splice(0, list.length - 1500);
    this.transcripts.set(event.sessionId, list);
    this.push({ type: 'transcript.event', event });
  }

  private updateStoredAssistant(sessionId: string, eventId: string, text: string, streaming: boolean): void {
    const list = this.transcripts.get(sessionId);
    if (!list) return;
    const idx = list.findIndex((e) => e.id === eventId);
    if (idx >= 0) {
      const prev = list[idx]!;
      if (prev.kind === 'assistant') {
        list[idx] = { ...prev, text, streaming };
      }
    }
  }

  getTranscript(sessionId: string): TranscriptEvent[] {
    return this.transcripts.get(sessionId) ?? [];
  }

  // -------------------------------------------------------------------------
  // Messaging / Telegram (spec §6.5, Phase 5)

  async telegramStatus(profileName: string): Promise<TelegramStatus> {
    try {
      const raw = await this.rest.messagingPlatforms(profileName);
      return parseTelegramStatus(raw);
    } catch {
      return { configured: false, enabled: false, state: 'disabled' };
    }
  }

  async configureTelegram(input: {
    profileName: string;
    token?: string;
    mentionOnly?: boolean;
    allowedUsers?: string[];
    enabled?: boolean;
    removeToken?: boolean;
  }): Promise<TelegramStatus> {
    const body: { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] } = {};
    if (input.enabled !== undefined) body.enabled = input.enabled;
    if (input.removeToken) {
      body.clear_env = ['TELEGRAM_BOT_TOKEN'];
    } else if (input.token) {
      // The token exists in main-process memory only for this call.
      registerSecret(input.token);
      body.env = { TELEGRAM_BOT_TOKEN: input.token };
    }
    if (input.mentionOnly !== undefined) {
      body.env = { ...body.env, TELEGRAM_MENTION_ONLY: input.mentionOnly ? 'true' : 'false' };
    }
    if (input.allowedUsers !== undefined) {
      body.env = { ...body.env, TELEGRAM_ALLOWED_USERS: input.allowedUsers.join(',') };
    }
    await this.rest.configurePlatform('telegram', body, input.profileName);
    const status = await this.telegramStatus(input.profileName);
    this.push({ type: 'gateway.status', profileName: input.profileName, status });
    this.updateBotGateway(input.profileName, status.state);
    return status;
  }

  async testTelegram(profileName: string): Promise<{ ok: boolean; message: string }> {
    try {
      const raw = await this.rest.testPlatform('telegram', profileName);
      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const ok = obj.ok !== false && obj.success !== false;
      return { ok, message: redact(String(obj.message ?? (ok ? 'Connection test passed' : 'Connection test failed'))) };
    } catch (err) {
      const pub = toPublicError(err);
      return { ok: false, message: pub.message };
    }
  }

  async gatewayAction(profileName: string, action: 'start' | 'stop' | 'restart'): Promise<TelegramStatus> {
    try {
      await this.rest.gateway(action, profileName);
    } catch (err) {
      const pub = toPublicError(err);
      throw new AppError(
        publicError('gateway/restart-failed', 'Gateway operation failed', pub.message, true, pub.diagnosticId),
      );
    }
    const status = await this.telegramStatus(profileName);
    this.push({ type: 'gateway.status', profileName, status });
    this.updateBotGateway(profileName, status.state);
    return status;
  }

  private updateBotGateway(profileName: string, state: TelegramStatus['state']): void {
    const bot = this.bots.get(profileName);
    if (bot) {
      const updated = { ...bot, gatewayState: state };
      this.bots.set(profileName, updated);
      this.push({ type: 'bot.updated', bot: updated });
    }
  }

  // -------------------------------------------------------------------------
  // Misc

  async getProfileConfig(profileName: string): Promise<{
    soul: string;
    modelInfo: unknown;
    modelOptions: unknown;
    toolsets: unknown;
    skills: unknown;
    mcp: unknown;
  }> {
    const [soul, modelInfo, modelOptions, toolsets, skills, mcp] = await Promise.all([
      this.capabilities.profilesSoul ? this.rest.getSoul(profileName).catch(() => '') : Promise.resolve(''),
      this.rest.modelInfo(profileName).catch(() => null),
      this.rest.modelOptions(profileName).catch(() => null),
      this.rest.toolsets(profileName).catch(() => null),
      this.capabilities.skills ? this.rest.skills(profileName).catch(() => null) : Promise.resolve(null),
      this.capabilities.mcp ? this.rest.mcp(profileName).catch(() => null) : Promise.resolve(null),
    ]);
    return { soul, modelInfo, modelOptions, toolsets, skills, mcp };
  }

  /**
   * Providers and models the server can actually serve. New bots must inherit
   * a provider that has credentials — hardcoding one produced profiles that
   * failed agent init with "No usable credentials found".
   */
  async modelOptions(profileName?: string): Promise<ModelOptions> {
    return await this.rest.modelOptions(profileName);
  }

  async getLogs(profileName?: string): Promise<LogLine[]> {
    const local = getLogLines();
    if (!this.capabilities.logs) return local;
    try {
      const remote = await this.rest.logs(profileName);
      const lines = Array.isArray(remote)
        ? remote
        : remote && typeof remote === 'object' && Array.isArray((remote as { logs?: unknown[] }).logs)
          ? (remote as { logs: unknown[] }).logs
          : [];
      const parsed: LogLine[] = lines.slice(-500).map((l) => {
        const o = l && typeof l === 'object' ? (l as Record<string, unknown>) : {};
        return {
          at: String(o.at ?? o.timestamp ?? ''),
          level: (['debug', 'info', 'warn', 'error'].includes(String(o.level)) ? String(o.level) : 'info') as LogLine['level'],
          scope: String(o.scope ?? o.source ?? 'hermes'),
          message: redact(String(o.message ?? o.msg ?? JSON.stringify(o)).slice(0, 1000)),
        };
      });
      return [...parsed, ...local];
    } catch {
      return local;
    }
  }

  diagnosticsReport(): string {
    return buildDiagnosticsReport({
      app: `${APP_NAME} 0.1.0`,
      hermesVersion: this.hermesVersion,
      connectionStatus: this.tunnel.status,
      host: this.settings.connection?.host,
      localPort: this.tunnel.localPort ? String(this.tunnel.localPort) : undefined,
      generatedAt: new Date().toISOString(),
    });
  }

  rest_(): DashboardClient {
    return this.rest;
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body: redact(body) }).show();
      }
    } catch {
      /* notifications unavailable */
    }
  }
}

function parseTelegramStatus(raw: unknown): TelegramStatus {
  const fallback: TelegramStatus = { configured: false, enabled: false, state: 'disabled' };
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.platforms) ? obj.platforms : Array.isArray(raw) ? (raw as unknown[]) : [];
  const tg = list.find((p) => {
    const pp = p as Record<string, unknown>;
    return pp.id === 'telegram' || pp.name === 'telegram' || pp.platform === 'telegram';
  }) as Record<string, unknown> | undefined;
  if (!tg) return fallback;
  const enabled = tg.enabled === true;
  const configured = tg.configured === true || tg.has_token === true || enabled;
  const running = tg.running === true || tg.connected === true || String(tg.status ?? '') === 'online';
  const degraded = String(tg.status ?? '') === 'degraded' || tg.error !== undefined;
  const env = tg.env && typeof tg.env === 'object' ? (tg.env as Record<string, unknown>) : {};
  return {
    configured,
    enabled,
    state: !configured ? 'disabled' : running ? 'online' : degraded ? 'degraded' : enabled ? 'offline' : 'disabled',
    mentionOnly: String(env.TELEGRAM_MENTION_ONLY ?? '') === 'true' || tg.mention_only === true,
    allowedUsers:
      typeof env.TELEGRAM_ALLOWED_USERS === 'string' && env.TELEGRAM_ALLOWED_USERS
        ? String(env.TELEGRAM_ALLOWED_USERS).split(',')
        : undefined,
    lastCheckedAt: new Date().toISOString(),
    recentErrors: tg.error ? [redact(String(tg.error)).slice(0, 300)] : undefined,
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
