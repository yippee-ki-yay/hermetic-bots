/** Command Header: breadcrumb, run state, connection capsule. */
import { useStore } from '../../state/store';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../common/Icon';
import { api, unwrap } from '../../app/api';
import type { RunState } from '@shared/contracts';

const RUN_LABEL: Record<RunState, string> = {
  ready: 'Ready',
  thinking: 'Thinking…',
  'tool-running': 'Tool running…',
  'waiting-approval': 'Waiting for approval',
  disconnected: 'Disconnected',
};

export function CommandHeader({
  profile,
  sessionId,
}: {
  profile: string;
  sessionId: string | null;
}): React.JSX.Element {
  const bots = useStore((s) => s.bots);
  const threads = useStore((s) => s.threads[profile]);
  const runState = useStore((s) => (sessionId ? (s.runStates[sessionId] ?? 'ready') : 'ready'));
  const connection = useStore((s) => s.connection);
  const navigate = useStore((s) => s.navigate);

  const showThreadDeck = useStore((s) => s.prefs.showThreadDeck);
  const toggleThreadDeck = useStore((s) => s.toggleThreadDeck);
  const reportError = useStore((s) => s.reportError);
  const loadThreads = useStore((s) => s.loadThreads);

  // Renaming a chat from the breadcrumb, since the thread panel that also
  // offers it is collapsed by default.
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenaming(false);
  }, [sessionId]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = async (): Promise<void> => {
    const title = draftTitle.trim();
    setRenaming(false);
    if (!sessionId || !title || title === thread?.title) return;
    try {
      await unwrap(api().threads.rename(sessionId, title));
      void loadThreads(profile);
    } catch (err) {
      reportError(err, 'Could not rename this chat');
    }
  };

  const bot = bots.find((b) => b.profileName === profile);
  const thread = threads?.find((t) => t.id === sessionId);

  const connLabel = connection?.label ?? 'Not connected';
  const connClass =
    connection?.status === 'online'
      ? 'online'
      : connection?.status === 'offline' || connection?.status === 'idle'
        ? 'offline'
        : 'reconnecting';

  return (
    <header className="cmd-header">
      <button
        className="icon-btn"
        aria-label={showThreadDeck ? 'Hide threads (⌘B)' : 'Show threads (⌘B)'}
        aria-pressed={showThreadDeck}
        title={showThreadDeck ? 'Hide threads ⌘B' : 'Show threads ⌘B'}
        onClick={toggleThreadDeck}
      >
        <Icon name={showThreadDeck ? 'panel-close' : 'panel-open'} size={18} />
      </button>
      <div className="crumb">
        <div className="crumb-path">
          <button
            className="crumb-bot"
            onClick={() => navigate({ view: 'bot-settings', profile, tab: 'overview' })}
            title="Bot settings"
          >
            {bot?.displayName ?? profile}
          </button>
          <span className="sep">/</span>
          {renaming ? (
            <input
              ref={inputRef}
              className="crumb-rename"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              autoFocus
            />
          ) : thread ? (
            <button
              className="crumb-bot"
              title="Rename this chat"
              onClick={() => {
                setDraftTitle(thread.title);
                setRenaming(true);
              }}
            >
              {thread.title}
            </button>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>New thread</span>
          )}
        </div>
        <div className={`crumb-state ${runState === 'waiting-approval' || runState === 'disconnected' ? 'attention' : ''}`}>
          {runState === 'thinking' || runState === 'tool-running' ? (
            <span className="run-lines">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {RUN_LABEL[runState]}
        </div>
      </div>
      {bot?.model ? <span className="usage-meter">{bot.model}</span> : null}
      <button
        className="icon-btn"
        aria-label="New thread (⌘N)"
        title="New thread ⌘N"
        onClick={() => navigate({ view: 'chat', profile, sessionId: null })}
      >
        <Icon name="plus" size={18} />
      </button>
      <button className="conn-capsule" onClick={() => navigate({ view: 'connection' })} aria-label={`Connection ${connLabel}, ${connection?.status ?? 'unknown'}`}>
        <span className={`conn-dot ${connClass}`} />
        {connLabel}
      </button>
      <button
        className="icon-btn"
        aria-label={`Configure ${bot?.displayName ?? profile}`}
        title="Bot settings"
        onClick={() => navigate({ view: 'bot-settings', profile, tab: 'overview' })}
      >
        <Icon name="settings" size={18} />
      </button>
    </header>
  );
}
