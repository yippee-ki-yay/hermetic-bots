/**
 * Transcript work log (spec §7.1): chronological event list with auto-follow
 * near the bottom, a New output button otherwise, incremental rendering for
 * long sessions, and a restrained live region for completed turns.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { AssistantTurn, UserTurn, ToolRow, SystemMarker } from './events';
import { ApprovalPanel, ClarifyPanel, SudoPanel, SecretPanel } from './RequestPanels';
import { avatarBodyColor } from '../shell/PersonaAvatar';
import type { TranscriptEvent } from '@shared/contracts';

const WINDOW_SIZE = 300;
const NEAR_BOTTOM_PX = 120;

export function Transcript({
  profile,
  sessionId,
}: {
  profile: string;
  sessionId: string;
}): React.JSX.Element {
  const events = useStore((s) => s.transcripts[sessionId]);
  const bots = useStore((s) => s.bots);
  const bot = bots.find((b) => b.profileName === profile);
  const outerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [windowStart, setWindowStart] = useState(0);
  const lastCount = useRef(0);
  const lastLiveAnnouncement = useRef('');

  const list = useMemo(() => events ?? [], [events]);
  const visible = useMemo(() => {
    const start = Math.max(0, list.length - WINDOW_SIZE - windowStart * WINDOW_SIZE);
    return { start, items: list.slice(start) };
  }, [list, windowStart]);

  // Track whether the user is near the bottom.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      setPinned(nearBottom);
      if (nearBottom) setHasNew(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-follow only when already near the bottom (spec §7.1).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
    } else if (list.length > lastCount.current) {
      setHasNew(true);
    }
    lastCount.current = list.length;
  }, [list, pinned]);

  // Reset scroll state when switching sessions.
  useEffect(() => {
    setPinned(true);
    setHasNew(false);
    setWindowStart(0);
    const el = outerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  // Restrained ARIA live region: completed turns and approvals only (§10).
  const liveText = useMemo(() => {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]!;
      if (e.kind === 'assistant' && !e.streaming) {
        return `${bot?.displayName ?? profile} finished responding`;
      }
      if ((e.kind === 'approval' || e.kind === 'sudo') && e.decision === 'pending') {
        return 'Approval requested';
      }
    }
    return '';
  }, [list, bot, profile]);
  useEffect(() => {
    lastLiveAnnouncement.current = liveText;
  }, [liveText]);

  const color = bot ? avatarBodyColor(bot.orb) : 'var(--accent-cyan)';

  const renderEvent = (e: TranscriptEvent): React.JSX.Element | null => {
    switch (e.kind) {
      case 'assistant':
        return <AssistantTurn key={e.id} event={e} botName={bot?.displayName ?? profile} botColor={color} />;
      case 'user':
        return <UserTurn key={e.id} event={e} />;
      case 'tool':
        return <ToolRow key={e.id} event={e} />;
      case 'approval':
        return <ApprovalPanel key={e.id} event={e} currentProfile={profile} />;
      case 'clarify':
        return <ClarifyPanel key={e.id} event={e} currentProfile={profile} />;
      case 'sudo':
        return <SudoPanel key={e.id} event={e} currentProfile={profile} />;
      case 'secret':
        return <SecretPanel key={e.id} event={e} currentProfile={profile} />;
      case 'system':
        return <SystemMarker key={e.id} event={e} />;
      default:
        return null;
    }
  };

  return (
    <div className="transcript-outer" ref={outerRef}>
      <div className="transcript" role="log" aria-label="Conversation">
        {visible.start > 0 ? (
          <button className="btn ghost" onClick={() => setWindowStart((w) => w + 1)}>
            Show earlier ({visible.start} more)
          </button>
        ) : null}
        {events === undefined ? (
          <div className="sys-marker">Loading history…</div>
        ) : (
          visible.items.map(renderEvent)
        )}
      </div>
      {hasNew ? (
        <button
          className="new-output-btn"
          onClick={() => {
            const el = outerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setPinned(true);
            setHasNew(false);
          }}
        >
          New output ↓
        </button>
      ) : null}
      <div aria-live="polite" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(100%)' }}>
        {liveText}
      </div>
    </div>
  );
}
