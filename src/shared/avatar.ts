/**
 * Persona avatar system, ported from the Claude Design source
 * ("Hermetic Avatar.dc.html" in the "Hermetic Bots logo design" project):
 * a crab sealed in a jar — the product name made literal.
 *
 * A persona's look is 5 jar shapes × 4 eye styles × 2 poses × 10 palettes,
 * so two bots differ in silhouette as well as colour and identity never rests
 * on colour alone.
 *
 * Anything not chosen explicitly is derived from the profile's seed, so an
 * existing bot gets a stable, distinct crab without any stored preference.
 */
import type { OrbDefinition } from './contracts';

export interface AvatarPalette {
  id: string;
  name: string;
  /** Shell fill; also the bot's identity colour elsewhere in the UI. */
  body: string;
  bodyDark: string;
  plate: string;
  glow: string;
  dome: string;
  rim: string;
  rimDark: string;
}

export const AVATAR_PALETTES: AvatarPalette[] = [
  { id: 'coral',  name: 'Coral',    body: '#F4795B', bodyDark: '#D95F45', plate: '#0E2C34', glow: '#4E8F98', dome: '#8FD8DE', rim: '#F0BC65', rimDark: '#C79240' },
  { id: 'amber',  name: 'Amber',    body: '#F2A93B', bodyDark: '#D08825', plate: '#241E30', glow: '#6B5B86', dome: '#C9B6E8', rim: '#E8D7A0', rimDark: '#BFA872' },
  { id: 'teal',   name: 'Teal',     body: '#3FBFAE', bodyDark: '#2A9A8B', plate: '#10202C', glow: '#46718F', dome: '#A8E6DE', rim: '#F0BC65', rimDark: '#C79240' },
  { id: 'violet', name: 'Violet',   body: '#9B7BE8', bodyDark: '#7A5AC7', plate: '#1A182E', glow: '#5A4E96', dome: '#D7CBF5', rim: '#E0B98C', rimDark: '#B58F63' },
  { id: 'rose',   name: 'Rose',     body: '#EF6F94', bodyDark: '#CE5276', plate: '#291726', glow: '#7E4A69', dome: '#F5CFDD', rim: '#F0BC65', rimDark: '#C79240' },
  { id: 'lime',   name: 'Lime',     body: '#A8CC48', bodyDark: '#86A833', plate: '#15231B', glow: '#4A7A52', dome: '#DCEFB4', rim: '#E8C46A', rimDark: '#BE9C45' },
  { id: 'azure',  name: 'Azure',    body: '#59A9F0', bodyDark: '#3E85CB', plate: '#0F1F2C', glow: '#3F6E96', dome: '#C4E2F8', rim: '#F0BC65', rimDark: '#C79240' },
  { id: 'sand',   name: 'Sand',     body: '#E0B776', bodyDark: '#BE955A', plate: '#231D17', glow: '#7A6247', dome: '#F0E2C8', rim: '#C79240', rimDark: '#9C6F2C' },
  { id: 'rust',   name: 'Rust',     body: '#E0574F', bodyDark: '#BC3E3A', plate: '#241419', glow: '#7C3B44', dome: '#F7C9C4', rim: '#F0BC65', rimDark: '#C79240' },
  { id: 'slate',  name: 'Slate',    body: '#9AAAB4', bodyDark: '#74848F', plate: '#161B1F', glow: '#48575F', dome: '#D6E1E7', rim: '#B9C6CE', rimDark: '#8E9CA5' },
];

/** Palette ids stored before the crab avatars existed. */
const LEGACY_PALETTE_IDS: Record<string, string> = {
  cyan: 'teal',
  sage: 'lime',
  lavender: 'violet',
};

export const JAR_SHAPES = ['bell', 'cylinder', 'flask', 'hex', 'bulb'] as const;
export const EYE_STYLES = ['stalks', 'cyclops', 'sleepy', 'wide'] as const;
export const POSES = ['rest', 'wave'] as const;

export type JarShape = (typeof JAR_SHAPES)[number];
export type EyeStyle = (typeof EYE_STYLES)[number];
export type Pose = (typeof POSES)[number];

export interface ResolvedAvatar {
  palette: AvatarPalette;
  jar: JarShape;
  eyes: EyeStyle;
  pose: Pose;
  showBubbles: boolean;
  /** Pupil offsets, within the ranges the design exposes. */
  gaze: number;
  gazeY: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function paletteById(id: string | undefined): AvatarPalette {
  const resolved = id ? (LEGACY_PALETTE_IDS[id] ?? id) : undefined;
  return AVATAR_PALETTES.find((p) => p.id === resolved) ?? AVATAR_PALETTES[0]!;
}

/** Everything needed to draw a persona, explicit choices first, seed second. */
export function resolveAvatar(orb: OrbDefinition): ResolvedAvatar {
  const h = hash(orb.seed || orb.paletteId || 'hermetic');
  const palette = orb.paletteId
    ? paletteById(orb.paletteId)
    : AVATAR_PALETTES[h % AVATAR_PALETTES.length]!;
  return {
    palette,
    jar: orb.jar ?? JAR_SHAPES[(h >>> 3) % JAR_SHAPES.length]!,
    eyes: orb.eyes ?? EYE_STYLES[(h >>> 7) % EYE_STYLES.length]!,
    pose: orb.pose ?? POSES[(h >>> 11) % POSES.length]!,
    showBubbles: true,
    // Design bounds: gaze -14..14, gazeY -8..12.
    gaze: (((h >>> 13) % 29) - 14),
    gazeY: (((h >>> 17) % 21) - 8),
  };
}

/** The bot's identity colour — used for the transcript's assistant rule. */
export function avatarBodyColor(orb: OrbDefinition): string {
  return resolveAvatar(orb).palette.body;
}
