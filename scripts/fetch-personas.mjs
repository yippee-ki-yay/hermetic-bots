/**
 * Vendor the persona library into the app at build time.
 *
 * The app deliberately cannot reach the internet at runtime — the renderer's
 * CSP blocks remote resources and main only talks to the SSH tunnel — so the
 * catalogue is fetched here, converted, and committed as data. Re-run to
 * refresh:
 *
 *   npm run personas
 *
 * Source: github.com/msitarzewski/agency-agents (MIT). Attribution lives in
 * THIRD-PARTY-NOTICES.md and travels with the generated file.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = {
  repo: 'msitarzewski/agency-agents',
  url: 'https://github.com/msitarzewski/agency-agents',
  license: 'MIT',
  tarball: 'https://codeload.github.com/msitarzewski/agency-agents/tar.gz/refs/heads/main',
};

/** Bodies are trimmed so the bundle stays sane; SOULs are editable anyway. */
const MAX_SOUL_CHARS = 9000;

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };
  const block = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const meta = {};
  for (const line of block.split('\n')) {
    const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body };
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

const tmp = mkdtempSync(join(tmpdir(), 'personas-'));
try {
  console.log(`fetching ${SOURCE.repo}…`);
  const tar = join(tmp, 'src.tar.gz');
  execFileSync('/usr/bin/curl', ['-sL', SOURCE.tarball, '-o', tar]);
  execFileSync('/usr/bin/tar', ['-xzf', tar, '-C', tmp]);
  const extracted = readdirSync(tmp).find((n) => n.startsWith('agency-agents-'));
  if (!extracted) throw new Error('tarball layout unexpected');
  const base = join(tmp, extracted);

  // Divisions are the top-level directories holding agent markdown.
  const skip = new Set(['.github', 'scripts', 'examples', 'integrations', 'docs', 'assets', '.git']);
  const divisions = readdirSync(base).filter(
    (n) => !n.startsWith('.') && !skip.has(n) && statSync(join(base, n)).isDirectory(),
  );

  const personas = [];
  for (const division of divisions) {
    for (const file of readdirSync(join(base, division))) {
      if (!file.endsWith('.md') || file.toUpperCase() === 'README.MD') continue;
      const raw = readFileSync(join(base, division, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const id = file.replace(/\.md$/, '');
      const name = meta.name || titleCase(id.replace(new RegExp(`^${division}-`), ''));
      let soul = body.trim();
      if (soul.length > MAX_SOUL_CHARS) {
        soul = `${soul.slice(0, MAX_SOUL_CHARS).replace(/\s+\S*$/, '')}\n\n_(Trimmed for the bundled library — edit freely.)_`;
      }
      if (!soul) continue;
      personas.push({
        id,
        name,
        division,
        description: meta.description || meta.vibe || '',
        vibe: meta.vibe || '',
        soul,
      });
    }
  }

  personas.sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: SOURCE,
    divisions: [...new Set(personas.map((p) => p.division))].sort(),
    personas,
  };
  mkdirSync(join(ROOT, 'resources'), { recursive: true });
  const target = join(ROOT, 'resources/personas.json');
  writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);

  const bytes = statSync(target).size;
  console.log(`wrote ${personas.length} personas across ${out.divisions.length} divisions`);
  console.log(`divisions: ${out.divisions.join(', ')}`);
  console.log(`size: ${(bytes / 1024 / 1024).toFixed(2)} MB → resources/personas.json`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
