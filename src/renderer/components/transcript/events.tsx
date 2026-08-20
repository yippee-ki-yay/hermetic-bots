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

export function SystemMarker({ event }: { event: SystemEvent }): React.JSX.Element {
  return (
    <div className="sys-marker" id={`evt-${event.id}`} role="status">
      {event.label}
    </div>
  );
}

export { avatarBodyColor };
