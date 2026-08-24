/** First-launch welcome + connection setup. */
import { useState } from 'react';
import { useStore } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { CONNECTION_DEFAULTS } from '@shared/contracts';
import { APP_NAME } from '@shared/branding';
import type { AuthMethod } from '@shared/contracts';

export function ConnectionSetup({ editing }: { editing?: boolean }): React.JSX.Element {
  const storedConfig = useStore((s) => s.storedConfig);
  const reportError = useStore((s) => s.reportError);
  const navigate = useStore((s) => s.navigate);

  const [label, setLabel] = useState(storedConfig?.label ?? CONNECTION_DEFAULTS.label);
  const [host, setHost] = useState(storedConfig?.host ?? CONNECTION_DEFAULTS.host);
  const [port, setPort] = useState(String(storedConfig?.port ?? CONNECTION_DEFAULTS.port));
  const [user, setUser] = useState(storedConfig?.user ?? CONNECTION_DEFAULTS.user);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(storedConfig?.authMethod ?? 'agent');
  const [keyPath, setKeyPath] = useState(storedConfig?.keyPathLabel ?? '');
  const [sshConfigHost, setSshConfigHost] = useState(storedConfig?.sshConfigHost ?? '');
  const [busy, setBusy] = useState(false);

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      await unwrap(
        api().connection.connect({
          label: label.trim() || 'Hermes VPS',
          host: host.trim(),
          port: Number(port) || 22,
          user: user.trim(),
          authMethod,
          keyPath: authMethod === 'key-file' ? keyPath.trim() || undefined : undefined,
          sshConfigHost: authMethod === 'ssh-config-host' ? sshConfigHost.trim() || undefined : undefined,
          remotePort: CONNECTION_DEFAULTS.remoteDashboardPort,
        }),
      );
      navigate({ view: 'connection' });
    } catch (err) {
      reportError(err, 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="workspace">
      <div className="cmd-header" style={{ borderBottom: 'none' }} />
      <div className="center-view">
        <div className="center-col" style={{ maxWidth: 560 }}>
          <div className="view-title">{editing ? 'Edit connection' : `Welcome to ${APP_NAME}`}</div>
          <p className="view-sub">
            Hermes already runs on your remote server. This app reaches it through a private SSH
            tunnel: the Hermes dashboard stays bound to the server&apos;s loopback interface and is
            never opened to the public internet. Closing this app closes the tunnel; remote Hermes
            and Telegram services keep running.
          </p>
          <div className="card">
            <h3>Server</h3>
            <div className="field">
              <label>Connection label</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>SSH host</label>
                <input type="text" value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} />
              </div>
              <div className="field">
                <label>SSH port</label>
                <input type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>SSH user</label>
              <input type="text" value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
            </div>
          </div>
          <div className="card">
            <h3>Authentication</h3>
            <div className="radio-cards">
              <button className={`radio-card ${authMethod === 'agent' ? 'on' : ''}`} onClick={() => setAuthMethod('agent')}>
                <div>
                  <div className="rc-title">SSH agent / default keys (recommended)</div>
                  <div className="rc-desc">
                    Uses your existing OpenSSH setup — ssh-agent, default key files, and known hosts —
                    exactly as the terminal would.
                  </div>
                </div>
              </button>
              <button className={`radio-card ${authMethod === 'key-file' ? 'on' : ''}`} onClick={() => setAuthMethod('key-file')}>
                <div style={{ width: '100%' }}>
                  <div className="rc-title">Existing private key file</div>
                  <div className="rc-desc">
                    Points ssh at a key file path. The key contents never enter this app — never paste
                    private key material anywhere.
                  </div>
                  {authMethod === 'key-file' ? (
                    <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                      <input
                        type="text"
                        placeholder="~/.ssh/id_ed25519"
                        value={keyPath}
                        onChange={(e) => setKeyPath(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  ) : null}
                </div>
              </button>
              <button className={`radio-card ${authMethod === 'ssh-config-host' ? 'on' : ''}`} onClick={() => setAuthMethod('ssh-config-host')}>
                <div style={{ width: '100%' }}>
                  <div className="rc-title">Named host from ~/.ssh/config</div>
                  <div className="rc-desc">Connects to an alias your SSH config already defines.</div>
                  {authMethod === 'ssh-config-host' ? (
                    <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                      <input
                        type="text"
                        placeholder="hermes-vps"
                        value={sshConfigHost}
                        onChange={(e) => setSshConfigHost(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  ) : null}
                </div>
              </button>
            </div>
          </div>
          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
            {editing ? (
              <button className="btn ghost" onClick={() => navigate({ view: 'connection' })}>
                Cancel
              </button>
            ) : null}
            <button className="btn primary" disabled={busy || !host.trim() || !user.trim()} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect securely'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
