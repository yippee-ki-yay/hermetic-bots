/** Chat workspace route: transcript + activity strip + composer, and the
 * no-session / disconnected states. */
import { useStore } from '../../state/store';
import { CommandHeader } from '../../components/shell/CommandHeader';
import { Transcript } from '../../components/transcript/Transcript';
import { ActivityStrip } from '../../components/composer/ActivityStrip';
import { Composer } from '../../components/composer/Composer';
import { PersonaAvatar } from '../../components/shell/PersonaAvatar';

const STARTERS: Record<string, string[]> = {
  default: [
    'Summarize where we left off',
    'What can you help me with?',
    'Review your current instructions',
  ],
};

function starterSuggestions(role?: string): string[] {
  if (!role) return STARTERS.default!;
  const r = role.toLowerCase();
  if (r.includes('research')) {
    return ['Survey recent work on a topic', 'Summarize where we left off', 'Draft a research memo outline'];
  }
  if (r.includes('op')) {
    return ['Check server health', 'List scheduled routines', 'Summarize recent activity'];
  }
  if (r.includes('chief') || r.includes('staff')) {
    return ['Plan my day', 'Summarize open threads', 'Draft a status update'];
  }
  if (r.includes('anal')) {
    return ['Summarize the latest report', 'Explain the biggest change this week', 'List open questions'];
  }
  return STARTERS.default!;
}

export function ChatView({
  profile,
  sessionId,
}: {
  profile: string;
  sessionId: string | null;
}): React.JSX.Element {
  const bots = useStore((s) => s.bots);
  const connection = useStore((s) => s.connection);
  const setDraft = useStore((s) => s.setDraft);
  const bot = bots.find((b) => b.profileName === profile);

  const disconnected =
    connection !== null &&
    connection.status !== 'online' &&
    connection.status !== 'idle';

  return (
    <main className="workspace">
      <CommandHeader profile={profile} sessionId={sessionId} />
      {disconnected ? (
        <div className="banner" role="status">
          <span className="spinner" aria-hidden="true" />
          Connection interrupted — reconnecting. Your draft and history are safe.
        </div>
      ) : null}
      {sessionId ? (
        <>
          <Transcript profile={profile} sessionId={sessionId} />
          <ActivityStrip sessionId={sessionId} />
        </>
      ) : (
        <div className="empty-state">
          {bot ? (
            <PersonaAvatar orb={bot.orb} size={72} title={bot.displayName} avatar={bot.avatarDataUri} />
          ) : null}
          <div className="es-title">{bot?.displayName ?? profile}</div>
          <div className="es-sub">{bot?.role ?? bot?.description ?? 'Start a new thread below.'}</div>
          <div className="starter-row">
            {starterSuggestions(bot?.role).map((s, i) => (
              <button
                key={i}
                className="starter-card"
                onClick={() => setDraft(`${profile}:new`, s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <Composer profile={profile} sessionId={sessionId} />
    </main>
  );
}
