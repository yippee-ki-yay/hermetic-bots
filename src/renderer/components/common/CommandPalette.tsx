/** ⌘K command/search palette. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';

interface PaletteEntry {
  id: string;
  label: string;
  kind: string;
  run: () => void;
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const bots = useStore((s) => s.bots);
  const threads = useStore((s) => s.threads);
  const navigate = useStore((s) => s.navigate);
  const selectBot = useStore((s) => s.selectBot);
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHl(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const entries = useMemo((): PaletteEntry[] => {
    const all: PaletteEntry[] = [
      ...bots.map((b) => ({
        id: `bot-${b.profileName}`,
        label: b.displayName,
        kind: 'bot',
        run: () => selectBot(b.profileName),
      })),
      ...Object.values(threads).flat().map((t) => ({
        id: `thread-${t.id}`,
        label: t.title,
        kind: 'thread',
        run: () => navigate({ view: 'chat', profile: t.profileName, sessionId: t.id }),
      })),
      { id: 'act-new-bot', label: 'New bot…', kind: 'action', run: () => navigate({ view: 'wizard' }) },
      { id: 'act-conn', label: 'Connection health', kind: 'action', run: () => navigate({ view: 'connection' }) },
      { id: 'act-settings', label: 'Application settings', kind: 'action', run: () => navigate({ view: 'settings' }) },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 12);
  }, [bots, threads, query, navigate, selectBot]);

  if (!open) return null;

  const pick = (entry: PaletteEntry | undefined): void => {
    if (!entry) return;
    setOpen(false);
    entry.run();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search bots, threads, actions…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHl(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHl((h) => Math.min(h + 1, entries.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(entries[hl]);
            }
          }}
        />
        <div className="palette-list" role="listbox">
          {entries.map((e, i) => (
            <button
              key={e.id}
              role="option"
              aria-selected={i === hl}
              className={`palette-item ${i === hl ? 'hl' : ''}`}
              onMouseEnter={() => setHl(i)}
              onClick={() => pick(e)}
            >
              {e.label}
              <span className="pi-kind">{e.kind}</span>
            </button>
          ))}
          {entries.length === 0 ? <div className="deck-empty">No matches</div> : null}
        </div>
      </div>
    </div>
  );
}
