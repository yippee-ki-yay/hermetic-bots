/** Application settings (spec §7.6). */
import { useState } from 'react';
import { useStore } from '../../state/store';
import { api, unwrap, isDemoMode } from '../../app/api';
import { Switch, ConfirmDialog } from '../../components/common/ui';

export function SettingsView(): React.JSX.Element {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const connection = useStore((s) => s.connection);
  const capabilities = useStore((s) => s.capabilities);
  const toast = useStore((s) => s.toast);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <main className="workspace">
      <div className="cmd-header">
        <div className="crumb">
          <div className="crumb-path">Settings</div>
        </div>
      </div>
      <div className="center-view">
        <div className="center-col">
          <div className="card">
            <h3>Appearance</h3>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Theme</div>
                <div className="tr-desc">The dark theme is the complete v1 theme; System maps to Dark for now.</div>
              </div>
              <div className="seg-row">
                <button className={prefs.theme === 'system' ? 'on' : ''} onClick={() => void setPrefs({ ...prefs, theme: 'system' })}>
                  System
                </button>
                <button className={prefs.theme === 'dark' ? 'on' : ''} onClick={() => void setPrefs({ ...prefs, theme: 'dark' })}>
                  Dark
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Composer</h3>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Enter sends the message</div>
                <div className="tr-desc">When off, Enter inserts a newline and Shift+Enter sends.</div>
              </div>
              <Switch on={prefs.enterToSend} label="Enter to send" onChange={(v) => void setPrefs({ ...prefs, enterToSend: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Notifications</h3>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Approvals</div>
                <div className="tr-desc">Notify when a bot waits for an approval decision.</div>
              </div>
              <Switch on={prefs.notifyApprovals} label="Notify approvals" onChange={(v) => void setPrefs({ ...prefs, notifyApprovals: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Completed background runs</div>
              </div>
              <Switch on={prefs.notifyCompletedRuns} label="Notify completed runs" onChange={(v) => void setPrefs({ ...prefs, notifyCompletedRuns: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Connection failures</div>
              </div>
              <Switch on={prefs.notifyConnectionFailures} label="Notify connection failures" onChange={(v) => void setPrefs({ ...prefs, notifyConnectionFailures: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Startup</h3>
            <div className="toggle-row">
              <div>
                <div className="tr-title">Reconnect to the last server on launch</div>
              </div>
              <Switch on={prefs.reconnectOnLaunch} label="Reconnect on launch" onChange={(v) => void setPrefs({ ...prefs, reconnectOnLaunch: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Privacy</h3>
            <p className="view-sub" style={{ marginTop: 0 }}>
              No analytics or telemetry leave this machine. Diagnostics are copied only when you ask,
              and are sanitized first.
            </p>
            <div className="row-actions">
              <button className="btn danger" onClick={() => setConfirmClear(true)}>
                Clear local drafts &amp; cache
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Advanced</h3>
            <dl className="kv-list">
              <dt>App</dt>
              <dd className="mono">Hermes Bots 0.1.0{isDemoMode() ? ' (demo mode)' : ''}</dd>
              <dt>Hermes version</dt>
              <dd className="mono">{connection?.hermesVersion ?? 'unknown'}</dd>
              <dt>Local endpoint</dt>
              <dd className="mono">{connection?.localPort ? `http://127.0.0.1:${connection.localPort}` : '—'}</dd>
              <dt>Capabilities</dt>
              <dd className="mono">
                {capabilities
                  ? Object.entries(capabilities)
                      .filter(([, v]) => v === true)
                      .map(([k]) => k)
                      .join(', ') || 'none detected'
                  : 'not connected'}
              </dd>
            </dl>
          </div>
        </div>
      </div>
      {confirmClear ? (
        <ConfirmDialog
          title="Clear local data"
          body={<p>Removes locally stored drafts and cached route state. Server data is untouched.</p>}
          confirmLabel="Clear"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void unwrap(api().privacy.clearLocal()).then(() => toast('Local data cleared'));
          }}
        />
      ) : null}
    </main>
  );
}
