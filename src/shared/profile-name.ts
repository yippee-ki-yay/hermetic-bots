/**
 * Deriving a Hermes profile name from a human label.
 *
 * Hermes profile names are directory names, so they must be filesystem-safe
 * and unique. Creation asks only for a display name and derives the rest, so
 * the user never has to think about either constraint.
 */

/** "Growth & Marketing!" -> "growth-marketing" */
export function slugify(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 64);
}

/** Append a numeric suffix rather than colliding with an existing profile. */
export function uniqueSlug(base: string, taken: string[]): string {
  if (!base) return '';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`.slice(0, 64);
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}
