/**
 * Composer attachments.
 *
 * As with avatars, the renderer never names a path: it asks main to open the
 * native picker, and main reads the bytes and uploads them over the gateway.
 * The app usually runs on a different machine from Hermes, so a local path
 * would be meaningless there — every attach uses the byte-upload variants
 * (`image.attach_bytes`, `file.attach` with a data URL) rather than the
 * path-based ones.
 */
import { dialog, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { AppError, publicError } from '@shared/errors';
import { log } from './logging/logger';

/** Hermes rejects anything larger (`_ATTACH_BYTES_MAX_BYTES`). */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

export interface PickedFile {
  name: string;
  ext: string;
  /** `image` uploads as vision bytes; everything else stages as a file. */
  kind: 'image' | 'file';
  bytes: Buffer;
  mime: string;
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.pdf':
      return 'application/pdf';
    case '.md':
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}

export async function pickAttachments(parent: BrowserWindow | null): Promise<PickedFile[]> {
  const options = {
    title: 'Attach files',
    properties: ['openFile' as const, 'multiSelections' as const],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Documents', extensions: ['pdf', 'md', 'txt', 'csv', 'json', 'log'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];

  const picked: PickedFile[] = [];
  for (const path of result.filePaths.slice(0, 10)) {
    const bytes = await readFile(path);
    const name = basename(path);
    if (bytes.byteLength > MAX_ATTACH_BYTES) {
      throw new AppError(
        publicError(
          'ipc/invalid-request',
          'File too large',
          `${name} is larger than the 25 MB Hermes accepts for an attachment.`,
          false,
        ),
      );
    }
    const ext = extname(path).toLowerCase();
    picked.push({
      name,
      ext,
      kind: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      bytes,
      mime: mimeFor(ext),
    });
    // The chosen path is deliberately never returned to the renderer.
    log.info('attachments', `picked ${name} (${bytes.byteLength} bytes)`);
  }
  return picked;
}

export function toDataUrl(file: PickedFile): string {
  return `data:${file.mime};base64,${file.bytes.toString('base64')}`;
}
