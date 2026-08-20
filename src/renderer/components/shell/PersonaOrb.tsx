/**
 * Persona avatar (spec §7.1, §8.5): a filled circular avatar disc in the
 * bot's colour with its constellation emblem knocked out of it, generated
 * locally from OrbDefinition. Reads as a real profile picture at roster size
 * while keeping unique per-bot geometry, so identity never rests on colour
 * alone. Never a remote avatar URL.
 */
import type { OrbDefinition } from '@shared/contracts';
import { ORB_PALETTE } from '@shared/contracts';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function orbColor(orb: OrbDefinition): string {
  return ORB_PALETTE.find((p) => p.id === orb.paletteId)?.color ?? '#68d5df';
}

export function PersonaOrb({
  orb,
  size = 42,
  title,
}: {
  orb: OrbDefinition;
  size?: number;
  title?: string;
}): React.JSX.Element {
  const color = orbColor(orb);
  const h = hash(orb.seed);
  // Geometry is authored in a 100×100 space and scaled by `size`.
  const C = 50;

  // Emblem knocked out of the disc. Keeping it a single dark ink colour makes
  // the mark read cleanly at 34px and stays legible on every palette hue.
  const ink = '#0c1012';

  const coreR = 10 + (h % 4);
  // Radii are capped so the outermost ring plus any tick riding on it stays
  // clear of the disc edge — a tick clipped by the rim reads as a defect.
  const ringRadii: number[] = [];
  for (let i = 0; i < orb.ringCount; i++) {
    ringRadii.push(20 + i * 9 + ((h >>> (4 + i * 2)) % 3));
  }
  const outerR = ringRadii[ringRadii.length - 1] ?? 30;

  // Orbital ticks: deterministic angles from the seed + tick pattern.
  const tickCount = 3 + ((orb.tickPattern >>> 2) % 4); // 3..6
  const ticks: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < tickCount; i++) {
    const angle = (((h >>> (i * 4)) % 360) + orb.tickPattern * 7 + i * 137) % 360;
    const rad = (angle * Math.PI) / 180;
    const rr = ringRadii[i % ringRadii.length] ?? outerR;
    ticks.push({
      x: C + Math.cos(rad) * rr,
      y: C + Math.sin(rad) * rr,
      r: 3.4 + ((h >>> (i * 3)) % 2) * 1.4,
    });
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}

      {/* Avatar disc */}
      <circle cx={C} cy={C} r={49} fill={color} />
      {/* Soft upper highlight gives the disc some dimension without a gradient */}
      <circle cx={C} cy={38} r={34} fill="#ffffff" opacity={0.12} />
      {/* Crisp edge so light avatars still separate from light surfaces */}
      <circle cx={C} cy={C} r={49} fill="none" stroke={ink} strokeWidth={1.5} opacity={0.28} />

      {/* Constellation emblem, knocked out of the disc */}
      {ringRadii.map((r, i) => (
        <circle
          key={i}
          cx={C}
          cy={C}
          r={r}
          fill="none"
          stroke={ink}
          strokeWidth={i === ringRadii.length - 1 ? 4 : 3}
          opacity={0.62 + i * 0.12}
          strokeLinecap="round"
          strokeDasharray={
            orb.ringCount > 1 && i === 0 ? `${(h % 9) + 7} ${(h % 5) + 5}` : undefined
          }
        />
      ))}
      <circle cx={C} cy={C} r={coreR} fill={ink} opacity={0.9} />
      {ticks.map((t, i) => (
        <circle key={`t${i}`} cx={t.x} cy={t.y} r={t.r} fill={ink} opacity={0.88} />
      ))}
    </svg>
  );
}
