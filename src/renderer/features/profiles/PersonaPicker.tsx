/**
 * Persona library browser for the wizard's Persona step. Metadata is loaded
 * once from the bundled catalogue; the SOUL body is fetched only for the
 * persona the user actually picks.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../../app/api';
import { useStore } from '../../state/store';
import { Modal } from '../../components/common/ui';
import type { PersonaSummary } from '@shared/contracts';

function divisionLabel(division: string): string {
  return division
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function PersonaPicker({
  onPick,
  onClose,
}: {
  onPick: (persona: PersonaSummary, soul: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const [index, setIndex] = useState<{
    divisions: string[];
    personas: PersonaSummary[];
    attribution?: { repo: string; url: string; license: string };
  } | null>(null);
  const [query, setQuery] = useState('');
  const [division, setDivision] = useState<string>('all');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    void unwrap(api().personas.index())
      .then(setIndex)
      .catch((err) => reportError(err, 'Persona library unavailable'));
  }, [reportError]);

  const results = useMemo(() => {
    const all = index?.personas ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => (division === 'all' ? true : p.division === division))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.division.toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [index, query, division]);

  const choose = async (persona: PersonaSummary): Promise<void> => {
    setLoadingId(persona.id);
    try {
      const soul = await unwrap(api().personas.soul(persona.id));
      if (soul) onPick(persona, soul);
    } catch (err) {
      reportError(err, 'Could not load that persona');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Modal title="Persona library" onClose={onClose}>
      <div className="field" style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder={`Search ${index?.personas.length ?? ''} personas…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="deck-filters" style={{ padding: '0 0 10px', flexWrap: 'wrap', gap: 4 }}>
        <button className={`chip ${division === 'all' ? 'on' : ''}`} onClick={() => setDivision('all')}>
          All
        </button>
        {(index?.divisions ?? []).map((d) => (
          <button
            key={d}
            className={`chip ${division === d ? 'on' : ''}`}
            onClick={() => setDivision(d)}
          >
            {divisionLabel(d)}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: '46vh', overflowY: 'auto', margin: '0 -4px' }}>
        {index === null ? (
          <div className="deck-empty">Loading library…</div>
        ) : results.length === 0 ? (
          <div className="deck-empty">No personas match that search.</div>
        ) : (
          results.map((p) => (
            <button
              key={p.id}
              className="session-row"
              style={{ paddingLeft: 12 }}
              disabled={loadingId !== null}
              onClick={() => void choose(p)}
            >
              <div className="session-title">
                <span className="t">{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {divisionLabel(p.division)}
                </span>
              </div>
              {p.description ? (
                <div className="session-preview" style={{ whiteSpace: 'normal' }}>
                  {p.description.slice(0, 150)}
                </div>
              ) : null}
              {loadingId === p.id ? <div className="session-meta">Loading…</div> : null}
            </button>
          ))
        )}
      </div>
      {index?.attribution ? (
        <div className="view-sub" style={{ fontSize: 11.5, marginTop: 12 }}>
          Bundled from {index.attribution.repo} ({index.attribution.license}). Edit any persona
          after inserting it — nothing here is fixed.
        </div>
      ) : null}
    </Modal>
  );
}
