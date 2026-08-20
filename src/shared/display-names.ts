/**
 * Display names are app-owned; the canonical Hermes profile name is not
 * (spec §7.3). Hermes calls its launch profile `default`, which is a
 * technical identifier rather than something worth showing in a roster — so
 * presentation gets a friendlier label while every request, path, cron job,
 * and gateway binding keeps using the real profile name.
 */
const PRESENTATION_NAMES: Record<string, string> = {
  default: 'Main Bot',
};

/**
 * Resolve what to show for a profile. A display name the user set always
 * wins; otherwise fall back to a friendlier label, then the profile name.
 */
export function displayNameFor(profileName: string, userDisplayName?: string): string {
  const chosen = userDisplayName?.trim();
  if (chosen) return chosen;
  return PRESENTATION_NAMES[profileName] ?? profileName;
}
