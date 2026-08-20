/** Thread Deck (spec §7.1): sessions for the selected bot. */
import { useMemo, useState } from 'react';
import { useStore, type ThreadFilter } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { Icon } from '../common/Icon';
import { ContextMenu, ConfirmDialog, RelativeTime, type MenuItem } from '../common/ui';
import type { ThreadSummary } from '@shared/contracts';

const FILTERS: { id: ThreadFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'archived', label: 'Archived' },
];

export function ThreadDeck({ profile }: { profile: string }): React.JSX.Element {
  const bots = useStore((s) => s.bots);
  const threads = useStore((s) => s.threads[profile]);
  const route = useStore((s) => s.route);
  const filter = useStore((s) => s.threadFilter);
  const search = useStore((s) => s.threadSearch);
  const navigate = useStore((s) => s.navigate);
  const setThreadFilter = useStore((s) => s.setThreadFilter);
  const setThreadSearch = useStore((s) => s.setThreadSearch);
  const loadThreads = useStore((s) => s.loadThreads);
  const reportError = useStore((s) => s.reportError);
  const toast = useStore((s) => s.toast);
  const capabilities = useStore((s) => s.capabilities);

  const bot = bots.find((b) => b.profileName === profile);
  const [menu, setMenu] = useState<{ x: number; y: number; thread: ThreadSummary } | null>(null);
  const [deleting, setDeleting] = useState<ThreadSummary | null>(null);
  const [renaming, setRenaming] = useState<ThreadSummary | null>(null);
  const [renameText, setRenameText] = useState('');

  const selectedId = route.view === 'chat' ? route.sessionId : null;

  const visible = useMemo(() => {
    let list = threads ?? [];
    if (filter === 'active') list = list.filter((t) => t.state === 'active' || t.state === 'attention');
    else if (filter === 'archived') list = list.filter((t) => t.state === 'archived');
    else if (filter === 'scheduled') list = []; // routines deferred post-MVP
    else list = list.filter((t) => t.state !== 'archived');
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || (t.preview ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [threads, filter, search]);

  const menuItems = (thread: ThreadSummary): MenuItem[] => [
    {
      label: 'Rename',
      onSelect: () => {
        setRenameText(thread.title);
        setRenaming(thread);
      },
    },
    ...(capabilities?.sessionBranch
      ? [
          {
            label: 'Branch',
            onSelect: async () => {
              try {
                const newId = await unwrap(api().threads.branch(thread.id));
                toast('Thread branched');
                if (newId) navigate({ view: 'chat', profile, sessionId: newId });
              } catch (err) {
                reportError(err, 'Branch failed');
              }
            },
          },
        ]
      : []),
    {
      label: thread.state === 'archived' ? 'Unarchive' : 'Archive',
      onSelect: async () => {
        try {
          await unwrap(api().threads.archive(thread.id, thread.state !== 'archived'));
          void loadThreads(profile);
        } catch (err) {
          reportError(err, 'Archive failed');
        }
      },
    },
    { label: '', divider: true },
    { label: 'Delete…', danger: true, onSelect: () => setDeleting(thread) },
  ];

  return (
    <aside className="deck" aria-label={`Threads for ${bot?.displayName ?? profile}`}>
      <div className="deck-header">
        <div className="deck-title-row">
          <div style={{ minWidth: 0 }}>
            <div className="deck-bot-name">{bot?.displayName ?? profile}</div>
            <div className="deck-bot-role">{bot?.role ?? bot?.model ?? ''}</div>
          </div>
          <div className="deck-actions">
            <button
              className="icon-btn"
              aria-label="New thread (⌘N)"
              title="New thread ⌘N"
              onClick={() => navigate({ view: 'chat', profile, sessionId: null })}
            >
              <Icon name="plus" size={17} />
            </button>
            <button
              className="icon-btn"
              aria-label="Configure bot"
              title="Configure bot"
              onClick={() => navigate({ view: 'bot-settings', profile, tab: 'overview' })}
            >
              <Icon name="more" size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="deck-search-row">
        <input
          className="deck-search"
          type="text"
          placeholder="Search threads"
          aria-label="Search threads"
          value={search}
          onChange={(e) => setThreadSearch(e.target.value)}
        />
      </div>
      <div className="deck-filters" role="tablist" aria-label="Thread filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`chip ${filter === f.id ? 'on' : ''}`}
            onClick={() => setThreadFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="deck-list">
        {visible.length === 0 ? (
          <div className="deck-empty">
            {filter === 'scheduled'
              ? 'Routines arrive after the MVP.'
              : threads === undefined
                ? 'Loading threads…'
                : 'No threads here yet.'}
          </div>
        ) : (
          visible.map((t) => (
            <button
              key={t.id}
              className={`session-row ${selectedId === t.id ? 'selected' : ''}`}
              onClick={() => navigate({ view: 'chat', profile, sessionId: t.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, thread: t });
              }}
            >
              <div className="session-title">
                {t.state === 'active' ? (
                  <span className="run-lines" aria-label="running">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
                {t.state === 'attention' ? (
                  <span style={{ color: 'var(--accent-amber)' }} aria-label="needs attention">
                    ●
                  </span>
                ) : null}
                <span className="t">{t.title}</span>
              </div>
              {t.preview ? <div className="session-preview">{t.preview}</div> : null}
              <div className="session-meta">
                <RelativeTime iso={t.updatedAt} />
                {t.state === 'archived' ? <span>· archived</span> : null}
              </div>
            </button>
          ))
        )}
      </div>
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.thread)} onClose={() => setMenu(null)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete thread"
          body={
            <p>
              Delete <strong style={{ color: 'var(--text-primary)' }}>{deleting.title}</strong>? This
              removes the session from Hermes and cannot be undone.
            </p>
          }
          confirmLabel="Delete thread"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const target = deleting;
            setDeleting(null);
            try {
              await unwrap(api().threads.delete(target.id));
              if (selectedId === target.id) navigate({ view: 'chat', profile, sessionId: null });
              void loadThreads(profile);
            } catch (err) {
              reportError(err, 'Delete failed');
            }
          }}
        />
      ) : null}
      {renaming ? (
        <ConfirmDialog
          title="Rename thread"
          body={
            <div className="field">
              <label>Title</label>
              <input
                type="text"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                autoFocus
              />
            </div>
          }
          confirmLabel="Rename"
          onCancel={() => setRenaming(null)}
          onConfirm={async () => {
            const target = renaming;
            setRenaming(null);
            try {
              await unwrap(api().threads.rename(target.id, renameText.trim() || target.title));
              void loadThreads(profile);
            } catch (err) {
              reportError(err, 'Rename failed');
            }
          }}
        />
      ) : null}
    </aside>
  );
}
