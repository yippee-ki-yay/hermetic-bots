import { describe, it, expect } from 'vitest';
// @ts-expect-error - build-time script, plain JS with no type declarations
import { reshapeToSoul } from '../../scripts/reshape-soul.mjs';

/** Shaped like the upstream agent files: content nested under `###`. */
const SOURCE = `# Backend Architect Agent Personality

You are **Backend Architect**, a senior backend architect. You build robust systems.

## 🧠 Your Identity & Memory
- **Role**: System architecture specialist
- **Personality**: Strategic, security-focused. You never ship without tests.
- **Memory**: You remember patterns

## 🎯 Your Core Mission

### Design Excellence
- Choose the simplest architecture that satisfies current load

## 🚨 Critical Rules You Must Follow

### Security-First
- Implement defense in depth across all layers
- Never store credentials in source control

## 📋 Your Architecture Deliverables

### System Design
- Produce a deployment diagram for every service

## 💭 Your Communication Style

- **Be strategic**: "Designed microservices that scale to 10x load"
- **Think security**: "Added OAuth 2.0 and rate limiting"

## 🎯 Your Success Metrics
- 99.9% uptime
`;

const persona = { name: 'Backend Architect', description: 'Designs systems', vibe: 'Holds it up', soul: SOURCE };

describe('reshapeToSoul', () => {
  const out: string = reshapeToSoul(persona);

  it('emits the Hermes SOUL sections', () => {
    expect(out).toContain('# Personality');
    expect(out).toContain('# Style');
    expect(out).toContain('# Boundaries');
    expect(out).toContain('# Specialties');
  });

  it('captures content nested under subheadings', () => {
    // Regression: the section reader used to stop at the first `###`, which
    // emptied Critical Rules and Core Mission entirely.
    expect(out).toContain('defense in depth');
    expect(out).toContain('simplest architecture');
  });

  it('routes genuine prohibitions to Boundaries', () => {
    const boundaries = out.slice(out.indexOf('# Boundaries'), out.indexOf('# Specialties'));
    expect(boundaries).toContain('Never store credentials in source control');
    expect(boundaries).not.toContain('defense in depth');
  });

  it('keeps the style directive and drops its sample deliverable', () => {
    const style = out.slice(out.indexOf('# Style'), out.indexOf('# Boundaries'));
    expect(style).toContain('Be strategic');
    expect(style).not.toContain('10x load');
  });

  it('drops deliverables and metrics, which belong in AGENTS.md', () => {
    expect(out).not.toContain('deployment diagram');
    expect(out).not.toContain('99.9% uptime');
  });

  it('does not lowercase every sentence of a multi-sentence trait value', () => {
    expect(out).toContain('You never ship without tests');
  });

  it('stays small enough to survive Hermes prompt truncation', () => {
    expect(out.length).toBeLessThanOrEqual(2201);
    expect(out).not.toMatch(/ {2,}/);
  });

  it('still produces a usable SOUL when the source has no known sections', () => {
    const bare: string = reshapeToSoul({
      name: 'Minimal',
      description: 'Does a thing',
      vibe: '',
      soul: 'You are Minimal, a plain persona.',
    });
    expect(bare).toContain('# Personality');
    expect(bare).toContain('# Boundaries');
    expect(bare.length).toBeGreaterThan(50);
  });
});
