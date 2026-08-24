/** Application shell: three-zone layout, routing, shortcuts, overlays. */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { ConstellationRail } from '../components/shell/ConstellationRail';
import { ThreadDeck } from '../components/shell/ThreadDeck';
import { ChatView } from '../features/sessions/ChatView';
import { ConnectionSetup } from '../features/connection/ConnectionSetup';
import { ConnectionHealth } from '../features/connection/ConnectionHealth';
import { SettingsView } from '../features/settings/SettingsView';
import { NewBotWizard } from '../features/profiles/NewBotWizard';
import { BotDetails } from '../features/profiles/BotDetails';
import { CommandPalette } from '../components/common/CommandPalette';
import { Modal } from '../components/common/ui';
import { api, unwrap } from './api';

export function App(): React.JSX.Element {
  const booted = useStore((s) => s.booted);
  const route = useStore((s) => s.route);
  const configured = useStore((s) => s.configured);
  const trustPrompt = useStore((s) => s.trustPrompt);
  const toasts = useStore((s) => s.toasts);
  const showThreadDeck = useStore((s) => s.prefs.showThreadDeck);
  const boot = useStore((s) => s.boot);
  const navigate = useStore((s) => s.navigate);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const reportError = useStore((s) => s.reportError);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const state = useStore.getState();
      if (e.key === 'k') {
        e.preventDefault();
        state.setPaletteOpen(!state.paletteOpen);
      } else if (e.key === 'n' && e.shiftKey) {
        e.preventDefault();
        state.navigate({ view: 'wizard' });
      } else if (e.key === 'n') {
        e.preventDefault();
        const r = state.route;
        const profile = r.view === 'chat' || r.view === 'bot-settings' ? r.profile : state.bots[0]?.profileName;
        if (profile) state.navigate({ view: 'chat', profile, sessionId: null });
      } else if (e.key === 'b') {
        e.preventDefault();
        state.toggleThreadDeck();
      } else if (e.key === ',') {
        e.preventDefault();
        state.navigate({ view: 'settings' });
      } else if (e.key === 'C' && e.shiftKey) {
        e.preventDefault();
        state.navigate({ view: 'connection' });
      } else if (/^[1-9]$/.test(e.key)) {
        const bot = state.bots[Number(e.key) - 1];
        if (bot) {
          e.preventDefault();
          state.selectBot(bot.profileName);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!booted) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="spinner" />
      </div>
    );
  }

  let deck: React.JSX.Element | null = null;
  let workspace: React.JSX.Element;
  let shellClass = 'app-shell';

  if (!configured && route.view !== 'settings') {
    shellClass = 'app-shell no-deck';
    workspace = <ConnectionSetup />;
  } else {
    switch (route.view) {
      case 'chat':
        // The Thread Deck is collapsed by default; ⌘B or the header control
        // reveals it without disturbing the transcript.
        deck = showThreadDeck ? <ThreadDeck profile={route.profile} /> : null;
        if (!showThreadDeck) shellClass = 'app-shell no-deck';
        workspace = <ChatView profile={route.profile} sessionId={route.sessionId} />;
        break;
      case 'bot-settings':
        deck = showThreadDeck ? <ThreadDeck profile={route.profile} /> : null;
        if (!showThreadDeck) shellClass = 'app-shell no-deck';
        workspace = <BotDetails profile={route.profile} tab={route.tab} />;
        break;
      case 'wizard':
        shellClass = 'app-shell no-deck';
        workspace = <NewBotWizard />;
        break;
      case 'connection':
        shellClass = 'app-shell no-deck';
        workspace = <ConnectionHealth />;
        break;
      case 'settings':
        shellClass = 'app-shell no-deck';
        workspace = <SettingsView />;
        break;
      default:
        shellClass = 'app-shell no-deck';
        workspace = <ConnectionSetup />;
    }
  }

  return (
    <div className={shellClass}>
      <ConstellationRail />
      {route.view === 'wizard' ? workspace : (
        <>
          {deck}
          {workspace}
        </>
      )}
      <CommandPalette />
      {trustPrompt ? (
        <Modal
          title="Verify server identity"
          onClose={() => {
            void unwrap(api().connection.confirmHostKey(false)).catch(() => undefined);
            useStore.setState({ trustPrompt: null });
          }}
          actions={
            <>
              <button
                className="btn ghost"
                onClick={() => {
                  void unwrap(api().connection.confirmHostKey(false)).catch((e) => reportError(e, 'Failed'));
                  useStore.setState({ trustPrompt: null });
                }}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void unwrap(api().connection.confirmHostKey(true)).catch((e) => reportError(e, 'Trust failed'));
                  useStore.setState({ trustPrompt: null });
                }}
              >
                Trust and connect
              </button>
            </>
          }
        >
          <p>
            First connection to{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {trustPrompt.host}:{trustPrompt.port}
            </strong>
            . Verify this {trustPrompt.keyType} fingerprint against the one shown on the server
            (e.g. from your provider console) before trusting it:
          </p>
          <div className="fingerprint">{trustPrompt.fingerprint}</div>
          <p>The app never auto-accepts host keys, and it refuses changed keys outright.</p>
        </Modal>
      ) : null}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
        ))}
      </div>
      {route.view === 'wizard' ? null : null}
    </div>
  );
}
