/**
 * Per-bot image avatars.
 *
 * The renderer never names a path: it asks the main process to open the
 * native picker, and main reads, center-crops, downscales, and re-encodes the
 * image itself. That keeps the "no arbitrary filesystem bridge" rule intact
 * while letting the user set a real picture per persona.
 *
 * Processed avatars live under userData/avatars as ordinary image files and
 * reach the renderer as `data:` URIs, which the CSP allows for img-src.
 */
import { app, dialog, nativeImage, type BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, publicError } from '@shared/errors';
import { log } from './logging/logger';

/** Rendered at up to 84px (3× on retina); 192px keeps it crisp and small. */
const AVATAR_PX = 192;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
/**
 * Ceiling on the encoded avatar. Measured worst case at 192px — a full frame
 * of random noise, the least compressible input PNG can be handed — is ~84 KB,
 * so this is a guard rail rather than a routine path.
 */
const MAX_OUTPUT_BYTES = 256 * 1024;

const cache = new Map<string, string>();

function avatarDir(): string {
  return join(app.getPath('userData'), 'avatars');
}

/** Stable per-server, per-profile filename; the key itself may contain `/` or `:`. */
function fileFor(serverFingerprint: string, profileName: string): string {
  const digest = createHash('sha256')
    .update(`${serverFingerprint}::${profileName}`)
    .digest('hex')
    .slice(0, 32);
  return join(avatarDir(), `${digest}.png`);
}

function cacheKey(serverFingerprint: string, profileName: string): string {
  return `${serverFingerprint}::${profileName}`;
}

/**
 * Square-crop, downscale, and re-encode an arbitrary user-chosen image to a
 * bounded PNG. PNG keeps transparency for logo-style marks and stays small
 * enough at this size that a lossy format buys nothing.
 */
export function processImage(buf: Buffer): { data: Buffer; mime: string } {
  let img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) {
    throw new AppError(
      publicError(
        'ipc/invalid-request',
        'Unsupported image',
        'That file could not be read as an image. Try a PNG, JPEG, or WebP.',
        false,
      ),
    );
  }
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  if (width !== height) {
    img = img.crop({
      x: Math.round((width - side) / 2),
      y: Math.round((height - side) / 2),
      width: side,
      height: side,
    });
  }
  img = img.resize({ width: AVATAR_PX, height: AVATAR_PX, quality: 'best' });

  const png = img.toPNG();
  if (png.byteLength > MAX_OUTPUT_BYTES) {
    throw new AppError(
      publicError('ipc/invalid-request', 'Image too large', 'That image could not be reduced to a usable size.', false),
    );
  }
  return { data: png, mime: 'image/png' };
}

export function toDataUri(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Open the native picker and return the processed image, without storing it. */
export async function pickAvatar(parent: BrowserWindow | null): Promise<string | null> {
  const options = {
    title: 'Choose a bot picture',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return null;

  const source = await readFile(chosen);
  if (source.byteLength > MAX_SOURCE_BYTES) {
    throw new AppError(
      publicError('ipc/invalid-request', 'Image too large', 'Choose an image under 16 MB.', false),
    );
  }
  const { data, mime } = processImage(source);
  // The chosen path is deliberately not returned to the renderer.
  log.info('avatars', `picked image, encoded ${data.byteLength} bytes as ${mime}`);
  return toDataUri(mime, data);
}

/** Persist a processed data URI for a profile; returns the stored URI. */
export async function saveAvatar(
  serverFingerprint: string,
  profileName: string,
  dataUri: string,
): Promise<string> {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!match) {
    throw new AppError(
      publicError('ipc/invalid-request', 'Invalid image', 'The avatar payload was not a supported image.', false),
    );
  }
  const mime = match[1]!;
  const raw = Buffer.from(match[3]!, 'base64');
  // Re-encode rather than trusting renderer-supplied bytes.
  const { data, mime: outMime } = processImage(raw);

  await mkdir(avatarDir(), { recursive: true });
  await writeFile(fileFor(serverFingerprint, profileName), data, { mode: 0o600 });

  const uri = toDataUri(outMime, data);
  cache.set(cacheKey(serverFingerprint, profileName), uri);
  log.info('avatars', `stored avatar for ${profileName} (${data.byteLength} bytes, ${mime} → ${outMime})`);
  return uri;
}

async function removeAvatarFiles(serverFingerprint: string, profileName: string): Promise<void> {
  const path = fileFor(serverFingerprint, profileName);
  if (existsSync(path)) {
    try {
      await unlink(path);
    } catch {
      /* best effort */
    }
  }
}

export async function clearAvatar(serverFingerprint: string, profileName: string): Promise<void> {
  await removeAvatarFiles(serverFingerprint, profileName);
  cache.delete(cacheKey(serverFingerprint, profileName));
}

/** Read a stored avatar as a data URI, or undefined when none is set. */
export function loadAvatar(serverFingerprint: string, profileName: string): string | undefined {
  const key = cacheKey(serverFingerprint, profileName);
  const hit = cache.get(key);
  if (hit) return hit;
  const path = fileFor(serverFingerprint, profileName);
  if (!existsSync(path)) return undefined;
  try {
    // Synchronous by design: roster assembly is a hot path and these are
    // small, local files already bounded by the write-side budget.
    const uri = toDataUri('image/png', readFileSync(path));
    cache.set(key, uri);
    return uri;
  } catch {
    return undefined;
  }
}

export function clearAvatarCache(): void {
  cache.clear();
}
