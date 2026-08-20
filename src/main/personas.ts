/**
 * Bundled persona library (resources/personas.json), vendored at build time by
 * scripts/fetch-personas.mjs. Loaded lazily on first use: the catalogue is a
 * couple of megabytes and most sessions never open the New Bot wizard.
 *
 * The renderer only ever receives the lightweight index; a full SOUL body is
 * fetched one at a time when the user actually picks a persona.
 */
import { app } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logging/logger';
import type { PersonaSummary } from '@shared/contracts';

interface PersonaRecord extends PersonaSummary {
  soul: string;
}

interface LibraryFile {
  generatedAt: string;
  source: { repo: string; url: string; license: string };
  divisions: string[];
  personas: PersonaRecord[];
}

let library: LibraryFile | null = null;
let loadFailed = false;

function libraryPath(): string {
  // Resolves identically in dev (project root) and packaged (app.asar).
  return join(app.getAppPath(), 'resources', 'personas.json');
}

function load(): LibraryFile | null {
  if (library || loadFailed) return library;
  const path = libraryPath();
  try {
    if (!existsSync(path)) {
      loadFailed = true;
      log.warn('personas', 'persona library not bundled; the picker will be empty');
      return null;
    }
    const started = Date.now();
    library = JSON.parse(readFileSync(path, 'utf8')) as LibraryFile;
    log.info(
      'personas',
      `loaded ${library.personas.length} personas in ${Date.now() - started}ms`,
    );
    return library;
  } catch (err) {
    loadFailed = true;
    log.warn('personas', `persona library unreadable: ${(err as Error).message}`);
    return null;
  }
}

export interface PersonaIndex {
  divisions: string[];
  personas: PersonaSummary[];
  attribution?: { repo: string; url: string; license: string };
}

/** Metadata only — bodies stay in main until a persona is chosen. */
export function personaIndex(): PersonaIndex {
  const lib = load();
  if (!lib) return { divisions: [], personas: [] };
  return {
    divisions: lib.divisions,
    personas: lib.personas.map(({ id, name, division, description, vibe }) => ({
      id,
      name,
      division,
      description,
      vibe,
    })),
    attribution: lib.source,
  };
}

export function personaSoul(id: string): string | null {
  const lib = load();
  return lib?.personas.find((p) => p.id === id)?.soul ?? null;
}
