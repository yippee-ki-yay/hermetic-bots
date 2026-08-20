/**
 * Versioned JSON settings store (spec §11.5). Holds only nonsecret data:
 * connection metadata, prefs, orb/display metadata, last route, drafts
 * (drafts are stored encrypted via secure-store when available).
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppPreferences, OrbDefinition } from '@shared/contracts';
import { DEFAULT_PREFERENCES } from '@shared/contracts';
import { log } from '../logging/logger';

const SCHEMA_VERSION = 1;

export interface StoredConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  authMethod: 'agent' | 'key-file' | 'ssh-config-host';
  keyPath?: string;
  sshConfigHost?: string;
  remotePort: number;
  /** Recorded after first successful trust so changed keys are detectable. */
  lastFingerprint?: string;
}

export interface OrbMetadataEntry {
  displayName?: string;
  role?: string;
  orb?: OrbDefinition;
}

interface SettingsShape {
  schemaVersion: number;
  connection?: StoredConnection;
  preferences: AppPreferences;
  lastRoute?: string;
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  /** Keyed `${serverFingerprint}::${profileName}` (spec §11.5). */
  orbMetadata: Record<string, OrbMetadataEntry>;
  /** Encrypted draft payloads keyed by draft key; values are base64 safeStorage blobs. */
  encryptedDrafts: Record<string, string>;
}

function defaults(): SettingsShape {
  return {
    schemaVersion: SCHEMA_VERSION,
    preferences: { ...DEFAULT_PREFERENCES },
    orbMetadata: {},
    encryptedDrafts: {},
  };
}

function migrate(data: Record<string, unknown>): SettingsShape {
  // Single version today; future migrations chain here.
  const base = defaults();
  return {
    ...base,
    ...data,
    schemaVersion: SCHEMA_VERSION,
    preferences: { ...base.preferences, ...(data.preferences as object | undefined) },
    orbMetadata: (data.orbMetadata as SettingsShape['orbMetadata']) ?? {},
    encryptedDrafts: (data.encryptedDrafts as SettingsShape['encryptedDrafts']) ?? {},
  };
}

/**
 * Product names this app has shipped under. Renaming moves `userData`, which
 * would silently orphan the saved connection, preferences, and avatars — so
 * adopt the newest previous directory on first run under the new name.
 */
const LEGACY_APP_DIRS = ['Hermes Bots'];

function adoptLegacyData(targetDir: string): void {
  if (existsSync(join(targetDir, 'settings.json'))) return;
  const parent = dirname(targetDir);
  for (const legacy of LEGACY_APP_DIRS) {
    const source = join(parent, legacy);
    if (source === targetDir || !existsSync(join(source, 'settings.json'))) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      cpSync(join(source, 'settings.json'), join(targetDir, 'settings.json'));
      const avatars = join(source, 'avatars');
      if (existsSync(avatars)) cpSync(avatars, join(targetDir, 'avatars'), { recursive: true });
      log.info('settings', `adopted settings from previous app name "${legacy}"`);
      return;
    } catch (err) {
      log.warn('settings', `could not adopt "${legacy}" data: ${(err as Error).message}`);
    }
  }
}

export class SettingsStore {
  private data: SettingsShape;
  private readonly file: string;

  constructor(dir = app.getPath('userData')) {
    mkdirSync(dir, { recursive: true });
    adoptLegacyData(dir);
    this.file = join(dir, 'settings.json');
    this.data = this.load();
  }

  private load(): SettingsShape {
    if (!existsSync(this.file)) return defaults();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      return migrate(raw);
    } catch {
      log.warn('settings', 'settings.json unreadable; starting from defaults');
      return defaults();
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get connection(): StoredConnection | undefined {
    return this.data.connection;
  }

  setConnection(conn: StoredConnection): void {
    this.data.connection = conn;
    this.save();
  }

  get preferences(): AppPreferences {
    return this.data.preferences;
  }

  setPreferences(p: AppPreferences): void {
    this.data.preferences = p;
    this.save();
  }

  get lastRoute(): string | undefined {
    return this.data.lastRoute;
  }

  setLastRoute(route: string): void {
    this.data.lastRoute = route;
    this.save();
  }

  get windowBounds(): SettingsShape['windowBounds'] {
    return this.data.windowBounds;
  }

  setWindowBounds(b: NonNullable<SettingsShape['windowBounds']>): void {
    this.data.windowBounds = b;
    this.save();
  }

  orbFor(serverFingerprint: string, profileName: string): OrbMetadataEntry | undefined {
    return this.data.orbMetadata[`${serverFingerprint}::${profileName}`];
  }

  setOrb(serverFingerprint: string, profileName: string, entry: OrbMetadataEntry): void {
    this.data.orbMetadata[`${serverFingerprint}::${profileName}`] = entry;
    this.save();
  }

  getEncryptedDraft(key: string): string | undefined {
    return this.data.encryptedDrafts[key];
  }

  setEncryptedDraft(key: string, blob: string | undefined): void {
    if (blob === undefined) delete this.data.encryptedDrafts[key];
    else this.data.encryptedDrafts[key] = blob;
    this.save();
  }

  clearLocalData(): void {
    this.data.encryptedDrafts = {};
    this.data.lastRoute = undefined;
    this.save();
  }
}
