/**
 * Reshape a source agent persona into a Hermes SOUL.md.
 *
 * Hermes' own guidance (docs/user-guide/features/personality) is that SOUL.md
 * carries *stable* identity — tone, directness, boundaries, how uncertainty is
 * handled — and explicitly NOT workflow, deliverables, or project specifics,
 * which belong in AGENTS.md. It is also truncated when large. The source
 * bodies are ~9 KB of mostly workflow, so this keeps the voice and drops the
 * process.
 *
 * Section vocabulary follows Soul Spec's merged shape (Identity, Tone & Style,
 * Boundaries, Specialties), which the ClawSouls Hermes guide maps onto SOUL.md.
 */

const MAX_SOUL_CHARS = 2200;

/**
 * Body of the first section whose heading matches, including its deeper
 * subsections — the source nests most of its content under `###`, so stopping
 * at the first subheading would drop nearly all of it.
 */
function sectionBody(soul, matcher) {
  const lines = soul.split('\n');
  let openLevel = 0;
  const out = [];
  for (const line of lines) {
    const h = /^(#{2,})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (openLevel && level <= openLevel) openLevel = 0; // section closed
      if (!openLevel && matcher.test(h[2])) openLevel = level;
      continue; // headings themselves are never body text
    }
    if (openLevel) out.push(line);
  }
  return out.join('\n').trim();
}

function stripDecoration(text) {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(text, max = 190) {
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

/** Plain bullets: keep the value, drop any `**Key**:` prefix. */
function bullets(block, limit) {
  const out = [];
  for (const raw of block.split('\n')) {
    const m = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!m) continue;
    const text = clamp(stripDecoration(m[1].replace(/^\*\*([^*]+)\*\*:\s*/, '')));
    if (text.length < 12) continue;
    if (!out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Style bullets read `**Be strategic**: "Designed microservices …"` — the bold
 * key is the actual directive and the quote is a sample deliverable, so keep
 * the key and discard the example.
 */
function styleBullets(block, limit) {
  const out = [];
  for (const raw of block.split('\n')) {
    const m = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!m) continue;
    const keyed = /^\*\*([^*]+)\*\*:\s*(.*)$/.exec(m[1]);
    let text;
    if (keyed) {
      const rest = keyed[2].trim();
      const isQuotedExample = /^["“]/.test(rest);
      text = isQuotedExample ? keyed[1] : `${keyed[1]}: ${rest}`;
    } else {
      text = m[1];
    }
    text = clamp(stripDecoration(text));
    if (text.length < 4) continue;
    if (!out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function boldValue(soul, key) {
  const re = new RegExp(`^\\s*[-*]\\s*\\*\\*${key}\\*\\*:\\s*(.+)$`, 'im');
  const m = re.exec(soul);
  return m ? stripDecoration(m[1]).replace(/\.$/, '') : '';
}

function openingParagraph(soul) {
  for (const para of soul.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p || p.startsWith('#') || p.startsWith('-') || p.startsWith('*')) continue;
    const flat = p.replace(/\s+/g, ' ');
    const sentences = flat.match(/[^.!?]+[.!?]+/g);
    return (sentences ? sentences.slice(0, 2).join(' ') : flat.slice(0, 300)).trim();
  }
  return '';
}

const NEGATIVE = /\b(never|avoid|do not|don't|must not|no longer|refuse|without ever)\b/i;

export function reshapeToSoul(persona) {
  const { name, description, vibe, soul } = persona;

  const identity = sectionBody(soul, /identity|memory/i);
  const styleBlock = sectionBody(soul, /communication style|tone|voice/i);
  const rulesBlock = sectionBody(soul, /critical rules|rules you must|boundaries|constraints/i);
  const missionBlock = sectionBody(soul, /core mission|expertise|specialt/i);

  const role = boldValue(identity || soul, 'Role');
  const traits = boldValue(identity || soul, 'Personality');

  // --- Personality ---------------------------------------------------------
  const personality = [openingParagraph(soul) || `You are ${name}. ${description}`.trim()];
  if (role) personality.push(`Your role is ${role.charAt(0).toLowerCase()}${role.slice(1)}.`);
  if (traits) {
    // Only the first character is lowered: these values are often several
    // sentences, and lowercasing all of them mangles every sentence start.
    const lead = `${traits.charAt(0).toLowerCase()}${traits.slice(1)}`.replace(/\.$/, '');
    personality.push(`You are ${clamp(lead, 220)}.`);
  }

  // --- Style ---------------------------------------------------------------
  let style = styleBullets(styleBlock, 5);
  if (style.length === 0) {
    style = [
      'Be direct and concrete; prefer plain statements over hedging.',
      'Say what you are confident about and what you are not.',
    ];
  }

  // --- Boundaries: genuine prohibitions only -------------------------------
  const allRules = bullets(rulesBlock, 40);
  const boundaries = allRules.filter((r) => NEGATIVE.test(r)).slice(0, 5);
  if (boundaries.length === 0) {
    boundaries.push('Flag anything ambiguous or risky instead of guessing.');
    boundaries.push('Never invent facts, sources, or data to fill a gap.');
  }

  // --- Specialties: the positive standards this persona holds --------------
  const positives = allRules.filter((r) => !NEGATIVE.test(r));
  const specialties = [...positives, ...bullets(missionBlock, 8)]
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 5);

  const parts = [
    '# Personality',
    personality.join(' ').replace(/\s{2,}/g, ' '),
    '',
    '# Style',
    ...style.map((s) => `- ${s}`),
    '',
    '# Boundaries',
    ...boundaries.map((s) => `- ${s}`),
  ];
  if (specialties.length > 0) {
    parts.push('', '# Specialties', ...specialties.map((s) => `- ${s}`));
  }

  let text = parts.join('\n').trim();
  if (text.length > MAX_SOUL_CHARS) {
    // Trim whole trailing lines: the tail is the least identity-bearing part.
    text = text.slice(0, MAX_SOUL_CHARS).replace(/\n[^\n]*$/, '').trim();
  }
  return `${text}\n`;
}
