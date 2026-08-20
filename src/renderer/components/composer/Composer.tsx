/**
 * Command Composer (spec §7.1): rectangular command dock. Enter sends
 * (reversible in preferences); during a run the send control becomes Stop and
 * additional submissions visibly steer.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore, draftKey } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { Icon } from '../common/Icon';

export function Composer({
  profile,
  sessionId,
}: {
  profile: string;
  sessionId: string | null;
}): React.JSX.Element {
  const key = draftKey(profile, sessionId);
  const draft = useStore((s) => s.drafts[key] ?? '');
  const setDraft = useStore((s) => s.setDraft);
  const prefs = useStore((s) => s.prefs);
  const bots = useStore((s) => s.bots);
  const runState = useStore((s) => (sessionId ? (s.runStates[sessionId] ?? 'ready') : 'ready'));
  const connection = useStore((s) => s.connection);
  const navigate = useStore((s) => s.navigate);
  const reportError = useStore((s) => s.reportError);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const loadedDraftKey = useRef<string | null>(null);

  const bot = bots.find((b) => b.profileName === profile);
  const running = runState === 'thinking' || runState === 'tool-running';
  const online = connection?.status === 'online';

  // Load persisted draft once per key.
  useEffect(() => {
    if (loadedDraftKey.current === key) return;
    loadedDraftKey.current = key;
    void unwrap(api().drafts.get(key)).then((text) => {
      if (text && !useStore.getState().drafts[key]) {
        setDraft(key, text);
      }
    }).catch(() => undefined);
  }, [key, setDraft]);

  // Auto-grow to six lines (CSS caps the height).
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || submitting || !online) return;
    setSubmitting(true);
    const requestId = crypto.randomUUID();
    const mode = running ? 'steer' : 'normal';
    try {
      setDraft(key, '');
      const { sessionId: sid } = await unwrap(
        api().chat.submit({ profileName: profile, sessionId, requestId, text, mode }),
      );
      if (!sessionId) {
        navigate({ view: 'chat', profile, sessionId: sid });
      }
    } catch (err) {
      // Restore the draft so nothing is silently lost (spec §2.4).
      setDraft(key, text);
      reportError(err, 'Prompt not sent');
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  };

  const stop = async (): Promise<void> => {
    if (!sessionId) return;
    try {
      await unwrap(api().chat.interrupt(sessionId));
    } catch (err) {
      reportError(err, 'Could not interrupt');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    const sendOnEnter = prefs.enterToSend;
    const wantsSend = sendOnEnter ? !e.shiftKey : e.shiftKey;
    if (wantsSend) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={`Ask ${bot?.displayName ?? profile}…`}
          aria-label={`Message ${bot?.displayName ?? profile}`}
          value={draft}
          disabled={!online && !sessionId}
          onChange={(e) => setDraft(key, e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-footer">
          <button className="icon-btn" aria-label="Attach context (coming soon)" disabled>
            <Icon name="paperclip" size={16} />
          </button>
          <button className="icon-btn" aria-label="Slash commands (coming soon)" disabled>
            <Icon name="slash" size={16} />
          </button>
          <span className="model-label">{bot?.model ?? ''}</span>
          <span className="spacer" />
          {running && draft.trim() ? (
            <span className="model-label" style={{ color: 'var(--accent-amber)' }}>
              will steer the active run
            </span>
          ) : null}
          {running ? (
            <button className="send-btn stop" aria-label="Stop the run" onClick={() => void stop()}>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="send-btn"
              aria-label="Send"
              disabled={!draft.trim() || submitting || !online}
              onClick={() => void submit()}
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
