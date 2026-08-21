/** Command Header (spec §7.1): breadcrumb, run state, connection capsule. */
import { useStore } from '../../state/store';
import { Icon } from '../common/Icon';
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
          <span style={{ color: thread ? undefined : 'var(--text-muted)' }}>
            {thread?.title ?? 'New thread'}
          </span>
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
