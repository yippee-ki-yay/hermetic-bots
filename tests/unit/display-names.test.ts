import { describe, it, expect } from 'vitest';
import { displayNameFor } from '../../src/shared/display-names';

describe('displayNameFor', () => {
  it('presents the Hermes launch profile as Main Bot', () => {
    expect(displayNameFor('default')).toBe('Main Bot');
  });

  it('never invents a name for other profiles', () => {
    expect(displayNameFor('researcher')).toBe('researcher');
    expect(displayNameFor('pnl-analyst')).toBe('pnl-analyst');
  });

  it('lets a user-set display name win, including over Main Bot', () => {
    expect(displayNameFor('default', 'Chief')).toBe('Chief');
    expect(displayNameFor('researcher', 'Researcher')).toBe('Researcher');
  });

  it('ignores a blank display name rather than showing empty chrome', () => {
    expect(displayNameFor('default', '   ')).toBe('Main Bot');
    expect(displayNameFor('ops', '')).toBe('ops');
  });
});
