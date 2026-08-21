import { describe, it, expect } from 'vitest';
import { orbMetadataSchema } from '../../src/shared/schemas';

/**
 * Mirrors AppController.setOrbMetadata's merge. A rename must not erase the
 * job title or avatar, which a plain spread of an IPC payload would do:
 * optional fields arrive as explicit `undefined`.
 */
function mergeMetadata<T extends Record<string, unknown>>(existing: T, entry: T): T {
  const patch = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
  return { ...existing, ...patch } as T;
}

describe('bot metadata merge', () => {
  const existing = {
    displayName: 'Product Manager',
    role: 'Product Manager',
    orb: { paletteId: 'azure', seed: 'product-manager' },
  };

  it('keeps the job title and avatar when only the name changes', () => {
    const merged = mergeMetadata(existing, {
      displayName: 'Prod',
      role: undefined,
      orb: undefined,
    } as unknown as typeof existing);
    expect(merged.displayName).toBe('Prod');
    expect(merged.role).toBe('Product Manager');
    expect(merged.orb).toEqual({ paletteId: 'azure', seed: 'product-manager' });
  });

  it('keeps the name when only the job title changes', () => {
    const merged = mergeMetadata(existing, {
      displayName: undefined,
      role: 'Head of Product',
      orb: undefined,
    } as unknown as typeof existing);
    expect(merged.displayName).toBe('Product Manager');
    expect(merged.role).toBe('Head of Product');
  });

  it('still allows clearing a job title explicitly', () => {
    const merged = mergeMetadata(existing, {
      displayName: undefined,
      role: '',
      orb: undefined,
    } as unknown as typeof existing);
    expect(merged.role).toBe('');
  });
});

describe('orbMetadataSchema', () => {
  it('accepts a name-only update', () => {
    expect(orbMetadataSchema.safeParse({ profileName: 'ops', displayName: 'Ops' }).success).toBe(true);
  });

  it('accepts a job-title-only update', () => {
    expect(orbMetadataSchema.safeParse({ profileName: 'ops', role: 'Operations' }).success).toBe(true);
  });

  it('rejects an unusable profile name', () => {
    expect(orbMetadataSchema.safeParse({ profileName: '../etc', displayName: 'x' }).success).toBe(false);
  });
});
