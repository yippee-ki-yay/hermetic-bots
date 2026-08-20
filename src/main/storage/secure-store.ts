/**
 * Thin wrapper over Electron safeStorage (macOS Keychain-backed).
 * Used for optional draft persistence. Transient secrets (Telegram tokens,
 * secret.respond values) are deliberately never persisted at all (spec §11.5).
 */
import { safeStorage } from 'electron';
import { log } from '../logging/logger';

export function encryptString(plain: string): string | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.encryptString(plain).toString('base64');
  } catch {
    log.warn('secure-store', 'encryption unavailable; value not persisted');
    return undefined;
  }
}

export function decryptString(blob: string): string | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    log.warn('secure-store', 'failed to decrypt stored value; discarding');
    return undefined;
  }
}
