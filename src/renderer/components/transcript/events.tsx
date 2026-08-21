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
        className="tool-row-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Tool ${event.toolName}, ${event.status}`}
      >
        <Icon name={toolIcon(event.toolName)} size={15} />
        <span className="tool-name">{event.toolName}</span>
        <span className={`tool-status ${event.status}`}>
          {event.status === 'running' ? (
            <>
              <span className="run-lines">
                <i />
                <i />
                <i />
              </span>
              running
            </>
          ) : event.status === 'failed' ? (
            'failed'
          ) : (
            <>{elapsed ?? 'done'}</>
          )}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        </span>
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

  // "read_file ×5, terminal, search_files ×2"
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.toolName, (counts.get(e.toolName) ?? 0) + 1);
  const names = [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .slice(0, 3)
    .join(', ');
  const more = counts.size > 3 ? `, +${counts.size - 3} more` : '';

  const totalMs = events.reduce((sum, e) => sum + (e.elapsedMs ?? 0), 0);
  const elapsed = totalMs > 0 ? (totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`) : null;

  return (
    <div className="tool-group">
      <button
        className="tool-row tool-row-head tool-group-head"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-label={`${events.length} tool calls, ${failed > 0 ? `${failed} failed` : running ? 'running' : 'complete'}`}
      >
        <Icon name="wrench" size={15} />
        <span className="tool-name">{events.length} tools</span>
        <span className="tool-group-names">{names}{more}</span>
        <span className={`tool-status ${failed > 0 ? 'failed' : running ? 'running' : 'complete'}`}>
          {running ? (
            <>
              <span className="run-lines">
                <i />
                <i />
                <i />
              </span>
              running
            </>
          ) : failed > 0 ? (
            `${failed} failed`
          ) : (
            (elapsed ?? 'done')
          )}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        </span>
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
