/**
 * Constellation orb persona mark (spec §7.1, §8.5): geometric core, rings,
 * and orbital ticks generated locally from OrbDefinition. Never a remote
 * avatar; identity never relies on color alone (unique geometry per seed).
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
  const c = size / 2;
  const coreR = size * (0.09 + ((h >>> 3) % 5) * 0.012);
  const rings: number[] = [];
  for (let i = 0; i < orb.ringCount; i++) {
    rings.push(size * (0.22 + i * 0.115) + ((h >>> (5 + i)) % 3));
  }
  const outerR = rings[rings.length - 1] ?? size * 0.3;

  // Orbital ticks: deterministic angles from seed + tickPattern.
  const tickCount = 3 + ((orb.tickPattern >>> 2) % 4); // 3..6
  const ticks: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < tickCount; i++) {
    const angle = (((h >>> (i * 4)) % 360) + orb.tickPattern * 7 + i * 137) % 360;
    const rad = (angle * Math.PI) / 180;
    const ringIdx = i % rings.length;
    const rr = rings[ringIdx] ?? outerR;
    ticks.push({
      x: c + Math.cos(rad) * rr,
      y: c + Math.sin(rad) * rr,
      r: 1.4 + ((h >>> (i * 3)) % 2) * 0.8,
    });
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {rings.map((r, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={i === rings.length - 1 ? 1.4 : 1}
          opacity={0.38 + i * 0.14}
          strokeDasharray={i === 0 && orb.ringCount > 1 ? `${(h % 4) + 3} ${(h % 3) + 2}` : undefined}
        />
      ))}
      <circle cx={c} cy={c} r={coreR} fill={color} />
      {ticks.map((t, i) => (
        <circle key={`t${i}`} cx={t.x} cy={t.y} r={t.r} fill={color} opacity={0.9} />
      ))}
    </svg>
  );
}
