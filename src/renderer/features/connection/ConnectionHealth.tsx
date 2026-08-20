/** Connection Health (spec §7.5): SSH / tunnel / Hermes / gateways / posture. */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { ConnectionSetup } from './ConnectionSetup';
import { formatRelative } from '../../components/common/ui';
import type { TelegramStatus, ConnectionStatus } from '@shared/contracts';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'Not connected',
  resolving: 'Resolving SSH',
  'awaiting-trust': 'Awaiting host trust',
  'starting-tunnel': 'Establishing tunnel',
  'checking-hermes': 'Checking Hermes',
  online: 'Online',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

const CONNECT_STEPS: { at: ConnectionStatus[]; label: string }[] = [
  { at: ['resolving', 'awaiting-trust'], label: 'Resolving SSH' },
  { at: ['starting-tunnel'], label: 'Establishing tunnel' },
  { at: ['checking-hermes'], label: 'Checking Hermes' },
  { at: ['online'], label: 'Loading bots' },
];

export function ConnectionHealth(): React.JSX.Element {
  const connection = useStore((s) => s.connection);
  const capabilities = useStore((s) => s.capabilities);
  const bots = useStore((s) => s.bots);
  const configured = useStore((s) => s.configured);
  const reportError = useStore((s) => s.reportError);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [gateways, setGateways] = useState<Record<string, TelegramStatus>>({});
  const [diag, setDiag] = useState<string | null>(null);

  useEffect(() => {
    if (connection?.status !== 'online' || !capabilities?.messagingTelegram) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, TelegramStatus> = {};
      for (const bot of bots.slice(0, 12)) {
        try {
          next[bot.profileName] = await unwrap(api().telegram.status(bot.profileName));
        } catch {
          /* skip */
        }
        if (cancelled) return;
      }
      setGateways(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [connection?.status, capabilities?.messagingTelegram, bots]);

  if (!configured || editing) {
    return <ConnectionSetup editing={configured} />;
  }

  const status = connection?.status ?? 'idle';
  const connecting = status !== 'online' && status !== 'idle' && status !== 'offline';
  const stepIndex = CONNECT_STEPS.findIndex((s) => s.at.includes(status));

  return (
    <main className="workspace">
      <div className="cmd-header">
        <div className="crumb">
          <div className="crumb-path">Connection health</div>
          <div className="crumb-state">{STATUS_LABEL[status]}</div>
        </div>
      </div>
      <div className="center-view">
        <div className="center-col">
          {connection?.lastError ? (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <h3 style={{ color: 'var(--danger)' }}>{connection.lastError.title}</h3>
              <p className="view-sub" style={{ marginTop: 0 }}>{connection.lastError.message}</p>
              {connection.lastError.diagnosticId ? (
                <p className="view-sub">Diagnostic id: {connection.lastError.diagnosticId}</p>
              ) : null}
            </div>
          ) : null}

          {connecting ? (
            <div className="card">
              <h3>Connecting</h3>
              <div className="connect-steps">
                {CONNECT_STEPS.map((s, i) => (
                  <div key={s.label} className={`connect-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}`}>
                    {i < stepIndex ? '✓' : i === stepIndex ? <span className="spinner" /> : '·'} {s.label}
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button className="btn" onClick={() => void unwrap(api().connection.disconnect()).catch(() => undefined)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="card">
            <h3>SSH</h3>
            <dl className="kv-list">
              <dt>Host</dt>
              <dd className="mono">{connection?.host}:{connection?.port}</dd>
              <dt>User</dt>
              <dd className="mono">{connection?.user}</dd>
              <dt>Host fingerprint</dt>
              <dd className="mono">{connection?.hostFingerprint ?? 'recorded on first trust'}</dd>
              <dt>Uptime</dt>
              <dd>{connection?.tunnelUptimeSec ? `${Math.floor(connection.tunnelUptimeSec / 60)}m` : '—'}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Tunnel</h3>
            <dl className="kv-list">
              <dt>Local endpoint</dt>
              <dd className="mono">{connection?.localPort ? `127.0.0.1:${connection.localPort}` : 'not established'}</dd>
              <dt>Remote target</dt>
              <dd className="mono">127.0.0.1:9119 (server loopback)</dd>
              <dt>Retry count</dt>
              <dd>{connection?.retryCount ?? 0}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Hermes</h3>
            <dl className="kv-list">
              <dt>Status</dt>
              <dd>
                <span className={`status-pill ${status === 'online' ? 'ok' : 'warn'}`}>{STATUS_LABEL[status]}</span>
              </dd>
              <dt>Version</dt>
              <dd className="mono">{connection?.hermesVersion ?? 'unknown'}</dd>
              <dt>Latency</dt>
              <dd>{connection?.latencyMs !== undefined ? `${connection.latencyMs}ms` : '—'}</dd>
              <dt>Last check</dt>
              <dd>{connection?.lastCheckedAt ? formatRelative(connection.lastCheckedAt) : '—'}</dd>
            </dl>
          </div>

          {Object.keys(gateways).length > 0 ? (
            <div className="card">
              <h3>Gateways</h3>
              <dl className="kv-list">
                {Object.entries(gateways).map(([profile, g]) => (
                  <FragmentRow key={profile} profile={profile} g={g} />
                ))}
              </dl>
            </div>
          ) : null}

          <div className="card">
            <h3>Security posture</h3>
            <dl className="kv-list">
              <dt>Dashboard exposure</dt>
              <dd>Remote loopback only — no public port required or requested</dd>
              <dt>Local tunnel bind</dt>
              <dd className="mono">127.0.0.1 only</dd>
              <dt>Renderer isolation</dt>
              <dd>Sandboxed, context-isolated, no Node access</dd>
            </dl>
          </div>

          <div className="row-actions">
            <button
              className="btn primary"
              onClick={() => void unwrap(api().connection.reconnect()).catch((e) => reportError(e, 'Reconnect failed'))}
            >
              Reconnect
            </button>
            <button
              className="btn"
              onClick={() => void unwrap(api().connection.test()).then(() => toast('Health check complete')).catch((e) => reportError(e, 'Test failed'))}
            >
              Test connection
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
              Edit connection
            </button>
            <button
              className="btn"
              onClick={() => void unwrap(api().connection.diagnostics()).then(setDiag).catch((e) => reportError(e, 'Diagnostics unavailable'))}
            >
              Open diagnostics
            </button>
            <button
              className="btn"
              onClick={() => void unwrap(api().connection.copyDiagnostics()).then(() => toast('Sanitized diagnostics copied')).catch((e) => reportError(e, 'Copy failed'))}
            >
              Copy sanitized report
            </button>
          </div>

          {diag ? (
            <div className="card">
              <h3>Diagnostics (sanitized)</h3>
              <div className="log-view">{diag}</div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function FragmentRow({ profile, g }: { profile: string; g: TelegramStatus }): React.JSX.Element {
  return (
    <>
      <dt>{profile}</dt>
      <dd>
        <span className={`status-pill ${g.state === 'online' ? 'ok' : g.state === 'degraded' ? 'warn' : 'muted'}`}>
          {g.state}
        </span>
      </dd>
    </>
  );
}
