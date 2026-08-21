import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../../src/renderer/features/profiles/NewBotWizard';
import { profileNameSchema } from '../../src/shared/schemas';

describe('slugify', () => {
  it('derives a filesystem-safe profile name from a label', () => {
    expect(slugify('Marketing')).toBe('marketing');
    expect(slugify('PnL Analyst')).toBe('pnl-analyst');
    expect(slugify('Chief of Staff')).toBe('chief-of-staff');
  });

  it('strips characters Hermes will not accept', () => {
    expect(slugify('Ops & Infra!')).toBe('ops-infra');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
    expect(slugify('123 numbers')).toBe('123-numbers');
  });

  it('never starts with a non-alphanumeric character', () => {
    expect(slugify('-leading')).toBe('leading');
    expect(slugify('...dots')).toBe('dots');
    expect(slugify('!!!')).toBe('');
  });

  it('produces names the IPC schema accepts', () => {
    for (const label of ['Marketing', 'PnL Analyst', 'Ops & Infra!', 'Über Bot 2']) {
      const slug = slugify(label);
      if (!slug) continue;
      expect(profileNameSchema.safeParse(slug).success).toBe(true);
    }
  });

  it('stays within the 64-character bound', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlug('marketing', ['default'])).toBe('marketing');
  });

  it('suffixes rather than colliding with an existing profile', () => {
    expect(uniqueSlug('marketing', ['marketing'])).toBe('marketing-2');
    expect(uniqueSlug('marketing', ['marketing', 'marketing-2'])).toBe('marketing-3');
  });

  it('passes an empty base straight through', () => {
    expect(uniqueSlug('', ['a'])).toBe('');
  });
});
