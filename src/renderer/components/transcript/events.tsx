/** Transcript event renderers (spec §7.1): open work log, not chat bubbles. */
import { useState } from 'react';
import type {
  AssistantMessageEvent,
  SystemEvent,
  ToolEvent,
  UserMessageEvent,
} from '@shared/contracts';
import { Markdown } from './Markdown';
import { Icon, type IconName } from '../common/Icon';
import { formatClock } from '../common/ui';
import { api, unwrap } from '../../app/api';
import { useStore } from '../../state/store';
import { avatarBodyColor } from '../shell/PersonaAvatar';

export function AssistantTurn({
  event,
  botName,
  botColor,
}: {
  event: AssistantMessageEvent;
  botName: string;
  botColor: string;
}): React.JSX.Element {
  return (
    <article className="turn-assistant" style={{ borderLeftColor: botColor }} id={`evt-${event.id}`}>
      <div className="turn-head">
        <span className="turn-name">{botName}</span>
        <span className="turn-time">{formatClock(event.at)}</span>
      </div>
      <div className="turn-body">
        <Markdown source={event.text} />
        {event.streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
      </div>
    </article>
  );
}

export function UserTurn({ event }: { event: UserMessageEvent }): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="turn-user" id={`evt-${event.id}`}>
      <div className="user-card">{event.text}</div>
      <div className="user-meta">
        <span className="turn-time">{formatClock(event.at)}</span>
        {event.steered ? <span>steering</span> : null}
        {event.delivery === 'submitting' ? <span>sending…</span> : null}
        {event.delivery === 'failed' ? <span style={{ color: 'var(--danger)' }}>failed</span> : null}
        {event.delivery === 'delivery-unknown' ? (
          <>
            <span className="delivery-unknown">delivery unknown</span>
            <button
              className="retry-btn"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await unwrap(api().chat.retry(event.requestId));
                } catch (err) {
                  reportError(err, 'Retry failed');
                } finally {
                  setRetrying(false);
                }
              }}
            >
              Retry
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Describe a run of tool calls the way a person would: "Ran 2 commands,
 * searched" rather than "3 tools terminal ×2, x_search". Names are bucketed
 * by what the call actually did, since the raw tool names are an
 * implementation detail of whichever toolset the profile has enabled.
 */
type ToolVerb = 'run' | 'read' | 'search' | 'write' | 'other';

function toolVerb(name: string): ToolVerb {
  if (/terminal|shell|bash|exec|command|sudo/i.test(name)) return 'run';
  if (/write|edit|patch|create|append|apply/i.test(name)) return 'write';
  if (/read|cat|open|fetch|get_file/i.test(name)) return 'read';
  if (/search|grep|find|browse|web|lookup|query/i.test(name)) return 'search';
  return 'other';
}

const PHRASES: Record<Exclude<ToolVerb, 'other'>, [string, (n: number) => string]> = {
  run: ['Ran a command', (n) => `Ran ${n} commands`],
  read: ['Read a file', (n) => `Read ${n} files`],
  search: ['Searched', (n) => `Ran ${n} searches`],
  write: ['Edited a file', (n) => `Edited ${n} files`],
};

export function summarizeTools(events: ToolEvent[]): string {
  const counts = new Map<ToolVerb, number>();
  const otherNames = new Set<string>();
  for (const e of events) {
    const verb = toolVerb(e.toolName);
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
    if (verb === 'other') otherNames.add(e.toolName);
  }
  const parts: string[] = [];
  for (const verb of ['run', 'read', 'search', 'write'] as const) {
    const n = counts.get(verb);
    if (!n) continue;
    parts.push(n === 1 ? PHRASES[verb][0] : PHRASES[verb][1](n));
  }
  if (otherNames.size > 0) {
    const names = [...otherNames].slice(0, 2).join(', ');
    parts.push(otherNames.size > 2 ? `${names}, +${otherNames.size - 2}` : names);
  }
  return parts.join(', ') || `${events.length} tools`;
}

function toolIcon(name: string): IconName {
  if (/terminal|shell|bash|exec/i.test(name)) return 'terminal';
  if (/web|search|http|fetch|browse/i.test(name)) return 'globe';
  if (/file|fs\.|read|write/i.test(name)) return 'file';
  return 'wrench';
}

export function ToolRow({ event }: { event: ToolEvent }): React.JSX.Element {
  // Collapsed by default after completion (spec §7.1).
  const [open, setOpen] = useState(false);
  const elapsed =
    event.elapsedMs !== undefined
      ? event.elapsedMs > 1000
        ? `${(event.elapsedMs / 1000).toFixed(1)}s`
        : `${event.elapsedMs}ms`
      : null;
  return (
    <div className="tool-row" id={`evt-${event.id}`}>
      <button
        className={`tool-row-head ${event.status}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Tool ${event.toolName}, ${event.status}`}
      >
        <span className="tool-line">
          {summarizeTools([event])}
          <span className="tool-line-name">{event.toolName}</span>
        </span>
        {event.status === 'running' ? (
          <span className="run-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : event.status === 'failed' ? (
          <span className="tool-line-failed">failed</span>
        ) : elapsed ? (
          <span className="tool-line-elapsed">{elapsed}</span>
        ) : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open ? (
        <div className="tool-detail">
          {event.inputPreview ? (
            <>
              <span className="lbl">Input</span>
              {event.inputPreview}
            </>
          ) : null}
          {event.outputPreview ? (
            <>
              <span className="lbl">Output</span>
              {event.outputPreview}
            </>
          ) : null}
          {event.errorPreview ? (
            <>
              <span className="lbl">Error</span>
              {event.errorPreview}
            </>
          ) : null}
          {!event.inputPreview && !event.outputPreview && !event.errorPreview ? 'No detail captured.' : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Consecutive tool calls collapse into one summary line.
 *
 * A long run of tool calls is scaffolding, not conversation — rendering each
 * as a full-width card buried the actual reply. The group stays open while
 * anything in it is still running, then closes itself once the run settles,
 * unless the user has taken control of it.
 */
export function ToolGroup({ events }: { events: ToolEvent[] }): React.JSX.Element {
  const running = events.some((e) => e.status === 'running');
  const failed = events.filter((e) => e.status === 'failed').length;
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? running;

  if (events.length === 1) return <ToolRow event={events[0]!} />;

  const totalMs = events.reduce((sum, e) => sum + (e.elapsedMs ?? 0), 0);
  const elapsed =
    totalMs > 0 ? (totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`) : null;

  return (
    <div className="tool-group">
      <button
        className="tool-row-head"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-label={`${events.length} tool calls, ${failed > 0 ? `${failed} failed` : running ? 'running' : 'complete'}`}
      >
        <span className="tool-line">{summarizeTools(events)}</span>
        {running ? (
          <span className="run-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : failed > 0 ? (
          <span className="tool-line-failed">{failed} failed</span>
        ) : elapsed ? (
          <span className="tool-line-elapsed">{elapsed}</span>
        ) : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open ? (
        <div className="tool-group-body">
          {events.map((e) => (
            <ToolRow key={e.id} event={e} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SystemMarker({ event }: { event: SystemEvent }): React.JSX.Element {
  return (
    <div className="sys-marker" id={`evt-${event.id}`} role="status">
      {event.label}
    </div>
  );
}

export { avatarBodyColor };
