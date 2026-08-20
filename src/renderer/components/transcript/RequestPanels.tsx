/**
 * Approval, clarification, sudo, and secret request panels (spec §6.6, §7.1).
 * Deliberate button presses only — Enter never approves. The secret value is
 * sent straight over IPC and never enters store state or persistence.
 */
import { useState } from 'react';
import type {
  ApprovalEvent,
  ClarificationEvent,
  SecretRequestEvent,
  SudoRequestEvent,
} from '@shared/contracts';
import { api, unwrap } from '../../app/api';
import { useStore } from '../../state/store';
import { Icon } from '../common/Icon';

function ScopeLine({
  profileName,
  currentProfile,
  serverLabel,
}: {
  profileName: string;
  currentProfile: string;
  serverLabel?: string;
}): React.JSX.Element | null {
  // Show the affected bot/server when it differs from the visible context.
  if (profileName === currentProfile) return null;
  return (
    <span className="rp-scope">
      → affects {profileName}
      {serverLabel ? ` on ${serverLabel}` : ''}
    </span>
  );
}

function DecisionLine({ decision }: { decision: string }): React.JSX.Element {
  const label =
    decision === 'approved'
      ? 'Approved once'
      : decision === 'denied'
        ? 'Denied'
        : decision === 'expired'
          ? 'Expired — no response was sent'
          : 'Answered';
  return <div className="rp-decision">{label}</div>;
}

export function ApprovalPanel({
  event,
  currentProfile,
}: {
  event: ApprovalEvent;
  currentProfile: string;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const connection = useStore((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pending = event.decision === 'pending';

  const respond = async (approve: boolean): Promise<void> => {
    setBusy(true);
    try {
      await unwrap(api().approvals.respondApproval(event.sessionId, event.requestId, approve));
    } catch (err) {
      reportError(err, 'Response failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`request-panel ${pending ? '' : 'decided'}`} id={`evt-${event.id}`} aria-label="Approval request">
      <div className="rp-kind">
        <Icon name="shield" size={14} />
        Approval
        <ScopeLine profileName={event.profileName} currentProfile={currentProfile} serverLabel={connection?.label} />
      </div>
      <div className="rp-summary">{event.summary}</div>
      {event.risk ? <div className="rp-summary" style={{ color: 'var(--accent-amber)', fontSize: 13 }}>{event.risk}</div> : null}
      {event.detail ? (
        expanded ? (
          <div className="rp-detail">{event.detail}</div>
        ) : (
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setExpanded(true)}>
            Show detail
          </button>
        )
      ) : null}
      {pending ? (
        <div className="rp-actions">
          <button className="btn" disabled={busy} onClick={() => void respond(false)}>
            Deny
          </button>
          <button className="btn warn" disabled={busy} onClick={() => void respond(true)}>
            Approve once
          </button>
          {event.timeoutAt ? <span className="rp-timeout">expires {new Date(event.timeoutAt).toLocaleTimeString()}</span> : null}
        </div>
      ) : (
        <DecisionLine decision={event.decision} />
      )}
    </section>
  );
}

export function ClarifyPanel({
  event,
  currentProfile,
}: {
  event: ClarificationEvent;
  currentProfile: string;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const connection = useStore((s) => s.connection);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = event.decision === 'pending';

  const send = async (value: string): Promise<void> => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await unwrap(api().approvals.respondClarify(event.sessionId, event.requestId, value));
    } catch (err) {
      reportError(err, 'Response failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`request-panel ${pending ? '' : 'decided'}`} id={`evt-${event.id}`} aria-label="Clarification request">
      <div className="rp-kind">
        <Icon name="alert" size={14} />
        Clarification
        <ScopeLine profileName={event.profileName} currentProfile={currentProfile} serverLabel={connection?.label} />
      </div>
      <div className="rp-summary">{event.question}</div>
      {pending ? (
        <>
          {event.options && event.options.length > 0 ? (
            <div className="rp-actions" style={{ flexWrap: 'wrap' }}>
              {event.options.map((opt, i) => (
                <button key={i} className="btn" disabled={busy} onClick={() => void send(opt)}>
                  {opt}
                </button>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            placeholder="Type an answer"
            value={answer}
            disabled={busy}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="rp-actions">
            <button className="btn primary" disabled={busy || !answer.trim()} onClick={() => void send(answer)}>
              Send answer
            </button>
          </div>
        </>
      ) : (
        <DecisionLine decision={event.decision} />
      )}
    </section>
  );
}

export function SudoPanel({
  event,
  currentProfile,
}: {
  event: SudoRequestEvent;
  currentProfile: string;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const connection = useStore((s) => s.connection);
  // Local component state only; never written to the store or persistence.
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = event.decision === 'pending';

  const respond = async (value: string): Promise<void> => {
    setBusy(true);
    try {
      await unwrap(api().approvals.respondSudo(event.sessionId, event.requestId, value));
      setPassword('');
    } catch (err) {
      reportError(err, 'Response failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`request-panel ${pending ? '' : 'decided'}`} id={`evt-${event.id}`} aria-label="Sudo password request">
      <div className="rp-kind">
        <Icon name="terminal" size={14} />
        Sudo password
        <ScopeLine profileName={event.profileName} currentProfile={currentProfile} serverLabel={connection?.label} />
      </div>
      <div className="rp-summary">{event.commandSummary}</div>
      <div className="rp-summary" style={{ color: 'var(--accent-amber)', fontSize: 13 }}>
        This grants root privileges for the pending command. Cancel unless you expected it.
      </div>
      {pending ? (
        <>
          <input
            type="password"
            placeholder="Sudo password"
            value={password}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="rp-actions">
            <button className="btn" disabled={busy} onClick={() => void respond('')}>
              Cancel
            </button>
            <button className="btn warn" disabled={busy || !password} onClick={() => void respond(password)}>
              Provide password once
            </button>
          </div>
          <div className="rp-decision">Sent directly to the gateway; never stored or logged by this app.</div>
        </>
      ) : (
        <DecisionLine decision={event.decision} />
      )}
    </section>
  );
}

export function SecretPanel({
  event,
  currentProfile,
}: {
  event: SecretRequestEvent;
  currentProfile: string;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const connection = useStore((s) => s.connection);
  // Local component state only; never written to the store or persistence.
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = event.decision === 'pending';

  const send = async (cancelled: boolean): Promise<void> => {
    setBusy(true);
    try {
      await unwrap(api().approvals.respondSecret(event.sessionId, event.requestId, cancelled ? '' : value, cancelled));
      setValue('');
    } catch (err) {
      reportError(err, 'Response failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`request-panel ${pending ? '' : 'decided'}`} id={`evt-${event.id}`} aria-label="Secret request">
      <div className="rp-kind">
        <Icon name="key" size={14} />
        Secret required
        <ScopeLine profileName={event.profileName} currentProfile={currentProfile} serverLabel={connection?.label} />
      </div>
      <div className="rp-summary">{event.prompt}</div>
      {pending ? (
        <>
          <input
            type="password"
            placeholder="Enter value"
            value={value}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="rp-actions">
            <button className="btn ghost" disabled={busy} onClick={() => void send(true)}>
              Cancel request
            </button>
            <button className="btn primary" disabled={busy || !value} onClick={() => void send(false)}>
              Send securely
            </button>
          </div>
          <div className="rp-decision">The value goes directly to Hermes and is never stored or logged by this app.</div>
        </>
      ) : (
        <DecisionLine decision={event.decision} />
      )}
    </section>
  );
}
