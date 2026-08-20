/**
 * Renderer API access. Unwraps IpcResult so callers get data or a thrown
 * PublicError. Falls back to the in-memory demo bridge when the preload API
 * is absent (browser preview / visual regression).
 */
import type { HermesApi, IpcResult } from '../../preload/api-types';
import type { PublicError } from '@shared/errors';
import { createDemoBridge } from './demo-bridge';

let bridge: HermesApi | null = null;

export function api(): HermesApi {
  if (bridge) return bridge;
  bridge = window.hermes ?? createDemoBridge();
  return bridge;
}

export class ApiError extends Error {
  constructor(public readonly publicError: PublicError) {
    super(publicError.message);
  }
}

export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const result = await p;
  if (result.ok) return result.data;
  throw new ApiError(result.error);
}

export function isDemoMode(): boolean {
  return !window.hermes;
}
