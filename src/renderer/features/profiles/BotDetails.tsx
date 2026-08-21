/** Bot details route with tabs (spec §7.4). */
import { useEffect, useState } from 'react';
import { useStore, type BotTab } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { PersonaAvatar } from '../../components/shell/PersonaAvatar';
import { ConfirmDialog, Switch, formatRelative } from '../../components/common/ui';
import type { LogLine, ModelOptions, TelegramStatus } from '@shared/contracts';

const TABS: { id: BotTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'persona', label: 'Persona' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'sessions', label: 'Memory & sessions' },
  { id: 'routines', label: 'Routines' },
  { id: 'logs', label: 'Logs' },
];

interface ProfileConfig {
  soul: string;
  modelInfo: unknown;
  modelOptions: ModelOptions | unknown;
  toolsets: unknown;
  skills: unknown;
  mcp: unknown;
}

export function BotDetails({ profile, tab }: { profile: string; tab: BotTab }): React.JSX.Element {
  const bots = useStore((s) => s.bots);
  const threads = useStore((s) => s.threads[profile]);
  const capabilities = useStore((s) => s.capabilities);
  const navigate = useStore((s) => s.navigate);
  const reportError = useStore((s) => s.reportError);
  const toast = useStore((s) => s.toast);
  const loadThreads = useStore((s) => s.loadThreads);

  const bot = bots.find((b) => b.profileName === profile);
  const [config, setConfig] = useState<ProfileConfig | null>(null);
  const [soulDraft, setSoulDraft] = useState<string | null>(null);
  const [savingSoul, setSavingSoul] = useState(false);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [tgToken, setTgToken] = useState('');
  const [tgBusy, setTgBusy] = useState(false);
  const [tgMessage, setTgMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveToken, setConfirmRemoveToken] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Name and job title are app-owned labels, editable at any time; the Hermes
  // profile name behind them stays fixed.
  const [identityName, setIdentityName] = useState('');
  const [identityRole, setIdentityRole] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);
  const identityDirty =
    identityName !== (bot?.displayName ?? '') || identityRole !== (bot?.role ?? '');

  useEffect(() => {
    // Re-seed when switching bots, or when a rename lands from elsewhere.
    setIdentityName(bot?.displayName ?? '');
    setIdentityRole(bot?.role ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, bot?.displayName, bot?.role]);

  const saveIdentity = async (): Promise<void> => {
    setSavingIdentity(true);
    try {
      await unwrap(
        api().bots.setOrb({
          profileName: profile,
          displayName: identityName.trim(),
          role: identityRole.trim(),
        }),
      );
      toast('Bot updated', identityName.trim());
    } catch (err) {
      reportError(err, 'Could not save the name');
    } finally {
      setSavingIdentity(false);
    }
  };

  useEffect(() => {
    setConfig(null);
    setSoulDraft(null);
    void unwrap(api().bots.getConfig(profile))
      .then(setConfig)
      .catch((err) => reportError(err, 'Could not load profile configuration'));
    if (!threads) void loadThreads(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (tab === 'telegram') {
      void unwrap(api().telegram.status(profile)).then(setTelegram).catch(() => undefined);
    }
    if (tab === 'logs') {
      void unwrap(api().logs.get(profile)).then(setLogs).catch(() => setLogs([]));
    }
  }, [tab, profile]);

  const soulValue = soulDraft ?? config?.soul ?? '';
  const soulDirty = soulDraft !== null && soulDraft !== config?.soul;

  const saveSoul = async (): Promise<void> => {
    setSavingSoul(true);
    try {
      await unwrap(api().bots.setSoul(profile, soulValue));
      setConfig((c) => (c ? { ...c, soul: soulValue } : c));
      setSoulDraft(null);
      toast('SOUL saved');
    } catch (err) {
      reportError(err, 'Could not save SOUL');
    } finally {
      setSavingSoul(false);
    }
  };

  const configureTg = async (patch: {
    token?: string;
    mentionOnly?: boolean;
    allowedUsers?: string[];
    enabled?: boolean;
    removeToken?: boolean;
  }): Promise<void> => {
    setTgBusy(true);
    setTgMessage(null);
    try {
      const status = await unwrap(api().telegram.configure({ profileName: profile, ...patch }));
      setTelegram(status);
      setTgToken('');
      toast('Telegram configuration updated');
    } catch (err) {
      reportError(err, 'Telegram configuration failed');
      if (patch.token) setTgToken('');
    } finally {
      setTgBusy(false);
    }
  };

  const filteredLogs = (logs ?? []).filter((l) =>
    logLevel === 'all' ? true : logLevel === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error',
  );

  return (
    <main className="workspace">
      <div className="cmd-header">
        <div className="crumb">
          <div className="crumb-path">
            {bot?.displayName ?? profile}
            <span className="sep">/</span>Settings
          </div>
        </div>
        <button className="btn" onClick={() => navigate({ view: 'chat', profile, sessionId: null })}>
          New thread
        </button>
      </div>
      <div className="center-view" style={{ paddingTop: 24 }}>
        <div className="center-col">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {bot ? <PersonaAvatar orb={bot.orb} size={56} avatar={bot.avatarDataUri} /> : null}
            <div style={{ minWidth: 0 }}>
              <div className="view-title">{bot?.displayName ?? profile}</div>
              <div className="view-sub" style={{ marginTop: 2 }}>
                {bot?.role ?? ''} · profile <span style={{ fontFamily: 'var(--font-mono)' }}>{profile}</span>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                className="btn"
                disabled={avatarBusy}
                onClick={async () => {
                  setAvatarBusy(true);
                  try {
                    const picked = await unwrap(api().avatar.pick());
                    if (picked) {
                      await unwrap(api().avatar.set(profile, picked));
                      toast('Picture updated');
                    }
                  } catch (err) {
                    reportError(err, 'Could not set the picture');
                  } finally {
                    setAvatarBusy(false);
                  }
                }}
              >
                {bot?.avatarDataUri ? 'Change picture' : 'Upload picture'}
              </button>
              {bot?.avatarDataUri ? (
                <button
                  className="btn ghost"
                  disabled={avatarBusy}
                  onClick={async () => {
                    setAvatarBusy(true);
                    try {
                      await unwrap(api().avatar.clear(profile));
                      toast('Picture removed');
                    } catch (err) {
                      reportError(err, 'Could not remove the picture');
                    } finally {
                      setAvatarBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab ${tab === t.id ? 'on' : ''}`}
                onClick={() => navigate({ view: 'bot-settings', profile, tab: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <>
              <div className="card">
                <h3>Identity</h3>
                <div className="field-row">
                  <div className="field">
                    <label>Name</label>
                    <input
                      type="text"
                      value={identityName}
                      placeholder={profile}
                      onChange={(e) => setIdentityName(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Job title</label>
                    <input
                      type="text"
                      value={identityRole}
                      placeholder="Product Manager"
                      onChange={(e) => setIdentityRole(e.target.value)}
                    />
                  </div>
                </div>
                <div className="hint" style={{ marginTop: -4 }}>
                  Both are labels this app owns. The Hermes profile stays{' '}
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{profile}</span>, because its
                  routines, gateway, and paths on the server refer to it by that name.
                </div>
                <div className="row-actions">
                  <button
                    className="btn ghost"
                    disabled={!identityDirty || savingIdentity}
                    onClick={() => {
                      setIdentityName(bot?.displayName ?? '');
                      setIdentityRole(bot?.role ?? '');
                    }}
                  >
                    Discard
                  </button>
                  <button
                    className="btn primary"
                    disabled={!identityDirty || savingIdentity || !identityName.trim()}
                    onClick={() => void saveIdentity()}
                  >
                    {savingIdentity ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="card">
                <dl className="kv-list">
                  <dt>Description</dt>
                  <dd>{bot?.description ?? '—'}</dd>
                  <dt>Model</dt>
                  <dd className="mono">{bot?.provider ?? '?'} / {bot?.model ?? '?'}</dd>
                  <dt>Gateway</dt>
                  <dd>
                    <span className={`status-pill ${bot?.gatewayState === 'online' ? 'ok' : bot?.gatewayState === 'degraded' ? 'warn' : 'muted'}`}>
                      {bot?.gatewayState ?? 'unknown'}
                    </span>
                  </dd>
                  <dt>Threads</dt>
                  <dd>{threads?.length ?? '—'}</dd>
                  {bot?.workingDir ? (
                    <>
                      <dt>Working directory</dt>
                      <dd className="mono">{bot.workingDir}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
              <div className="risk-flag">
                Profiles isolate Hermes state, not the server filesystem — this bot can reach the same
                files as any other profile on the VPS.
              </div>
              <div className="row-actions">
                <button className="btn" onClick={() => void unwrap(api().telegram.gateway(profile, 'restart')).then(() => toast('Gateway restarting')).catch((e) => reportError(e, 'Gateway restart failed'))}>
                  Restart gateway
                </button>
                <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                  Delete bot…
                </button>
              </div>
            </>
          ) : null}

          {tab === 'persona' ? (
            <div className="card">
              <h3>SOUL</h3>
              {config === null ? (
                <div className="view-sub">Loading…</div>
              ) : (
                <>
                  <textarea
                    className="soul-editor"
                    value={soulValue}
                    spellCheck={false}
                    onChange={(e) => setSoulDraft(e.target.value)}
                    aria-label="SOUL editor"
                  />
                  <div className="count-line">
                    {soulValue.length.toLocaleString()} chars{soulDirty ? ' · unsaved changes' : ''}
                  </div>
                  <div className="row-actions">
                    <button className="btn ghost" disabled={!soulDirty} onClick={() => setSoulDraft(null)}>
                      Discard changes
                    </button>
                    <button className="btn primary" disabled={!soulDirty || savingSoul} onClick={() => void saveSoul()}>
                      {savingSoul ? 'Saving…' : 'Save SOUL'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === 'capabilities' ? (
            <>
              <div className="card">
                <h3>Model</h3>
                <ModelPicker profile={profile} config={config} currentModel={bot?.model} currentProvider={bot?.provider} />
              </div>
              <div className="card">
                <h3>Tools &amp; toolsets</h3>
                <RawList data={config?.toolsets} empty="No toolset information from this Hermes version." />
              </div>
              <div className="card">
                <h3>Skills</h3>
                <RawList data={config?.skills} empty={capabilities?.skills ? 'No skills reported.' : 'Skills endpoint not available on this Hermes version.'} />
              </div>
              <div className="card">
                <h3>MCP servers</h3>
                <RawList data={config?.mcp} empty={capabilities?.mcp ? 'No MCP servers configured.' : 'MCP endpoint not available on this Hermes version.'} />
              </div>
            </>
          ) : null}

          {tab === 'telegram' ? (
            <>
              <div className="card">
                <h3>Status</h3>
                <dl className="kv-list">
                  <dt>Configured</dt>
                  <dd>{telegram ? (telegram.configured ? 'Yes' : 'No') : '…'}</dd>
                  <dt>Gateway</dt>
                  <dd>
                    <span className={`status-pill ${telegram?.state === 'online' ? 'ok' : telegram?.state === 'degraded' ? 'warn' : 'muted'}`}>
                      {telegram?.state ?? '…'}
                    </span>
                  </dd>
                  <dt>Last checked</dt>
                  <dd>{telegram?.lastCheckedAt ? formatRelative(telegram.lastCheckedAt) : '—'}</dd>
                </dl>
                {telegram?.recentErrors?.length ? (
                  <div className="log-view" style={{ marginTop: 10 }}>
                    {telegram.recentErrors.join('\n')}
                  </div>
                ) : null}
              </div>
              <div className="card">
                <h3>{telegram?.configured ? 'Replace token' : 'Connect a bot'}</h3>
                <p className="view-sub" style={{ marginTop: 0 }}>
                  Create a bot with @BotFather in Telegram and paste its token. Each persona needs its
                  own unique token. A saved token is never shown again.
                </p>
                <div className="field">
                  <label>{telegram?.configured ? 'New bot token' : 'Bot token'}</label>
                  <input
                    type="password"
                    value={tgToken}
                    autoComplete="off"
                    placeholder={telegram?.configured ? 'Configured — enter a new token to replace' : '123456789:AA…'}
                    onChange={(e) => setTgToken(e.target.value)}
                  />
                </div>
                <div className="toggle-row">
                  <div>
                    <div className="tr-title">Respond only when mentioned</div>
                  </div>
                  <Switch
                    on={telegram?.mentionOnly ?? true}
                    label="Mention only"
                    onChange={(v) => void configureTg({ mentionOnly: v })}
                  />
                </div>
                <div className="row-actions">
                  <button className="btn primary" disabled={tgBusy || !tgToken.trim()} onClick={() => void configureTg({ token: tgToken.trim(), enabled: true })}>
                    {telegram?.configured ? 'Replace token' : 'Save token'}
                  </button>
                  <button
                    className="btn"
                    disabled={tgBusy || !telegram?.configured}
                    onClick={() =>
                      void unwrap(api().telegram.test(profile))
                        .then((r) => setTgMessage(r.message))
                        .catch((e) => reportError(e, 'Test failed'))
                    }
                  >
                    Test connection
                  </button>
                  <button className="btn" disabled={tgBusy || !telegram?.configured} onClick={() => void unwrap(api().telegram.gateway(profile, 'restart')).then(setTelegram).catch((e) => reportError(e, 'Restart failed'))}>
                    Restart gateway
                  </button>
                  <button className="btn danger" disabled={tgBusy || !telegram?.configured} onClick={() => setConfirmRemoveToken(true)}>
                    Remove token…
                  </button>
                </div>
                {tgMessage ? <p className="view-sub">{tgMessage}</p> : null}
              </div>
            </>
          ) : null}

          {tab === 'sessions' ? (
            <div className="card">
              <h3>Recent sessions</h3>
              {(threads ?? []).slice(0, 10).map((t) => (
                <div key={t.id} className="toggle-row">
                  <div>
                    <div className="tr-title">{t.title}</div>
                    <div className="tr-desc">{formatRelative(t.updatedAt)} · {t.state}</div>
                  </div>
                  <button className="btn" onClick={() => navigate({ view: 'chat', profile, sessionId: t.id })}>
                    Open
                  </button>
                </div>
              ))}
              {(threads ?? []).length === 0 ? <div className="view-sub">No sessions yet.</div> : null}
            </div>
          ) : null}

          {tab === 'routines' ? (
            <div className="card">
              <h3>Routines</h3>
              <p className="view-sub" style={{ marginTop: 0 }}>
                Profile-scoped scheduled routines arrive after the MVP chat and configuration flows are
                stable (spec §7.4). Existing cron jobs on the server keep running unchanged.
              </p>
            </div>
          ) : null}

          {tab === 'logs' ? (
            <div className="card">
              <h3>Logs</h3>
              <div className="deck-filters" style={{ padding: '0 0 10px' }}>
                {(['all', 'warn', 'error'] as const).map((lvl) => (
                  <button key={lvl} className={`chip ${logLevel === lvl ? 'on' : ''}`} onClick={() => setLogLevel(lvl)}>
                    {lvl}
                  </button>
                ))}
                <span className="spacer" style={{ flex: 1 }} />
                <button
                  className="chip"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      filteredLogs.map((l) => `${l.at} [${l.level}] ${l.scope}: ${l.message}`).join('\n'),
                    );
                    toast('Redacted logs copied');
                  }}
                >
                  Copy (redacted)
                </button>
              </div>
              <div className="log-view">
                {logs === null
                  ? 'Loading…'
                  : filteredLogs.length === 0
                    ? 'No log lines at this level.'
                    : filteredLogs.map((l, i) => (
                        <div key={i} className={`log-line ${l.level}`}>
                          {l.at} [{l.level}] {l.scope}: {l.message}
                        </div>
                      ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete bot"
          danger
          requireText={profile}
          body={
            <p>
              This permanently deletes the Hermes profile <strong>{profile}</strong> on the server —
              its configuration, SOUL, memories, sessions, and gateway settings. Local display
              metadata is removed too. This cannot be undone.
            </p>
          }
          confirmLabel="Delete bot"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            try {
              await unwrap(api().bots.delete(profile, profile));
              toast('Bot deleted', profile);
              navigate({ view: 'connection' });
            } catch (err) {
              reportError(err, 'Delete failed');
            }
          }}
        />
      ) : null}
      {confirmRemoveToken ? (
        <ConfirmDialog
          title="Remove Telegram token"
          danger
          body={<p>The gateway for {bot?.displayName ?? profile} stops responding on Telegram until a new token is configured. The existing token is never displayed.</p>}
          confirmLabel="Remove token"
          onCancel={() => setConfirmRemoveToken(false)}
          onConfirm={() => {
            setConfirmRemoveToken(false);
            void configureTg({ removeToken: true, enabled: false });
          }}
        />
      ) : null}
    </main>
  );
}

/** Tolerant renderer for list-shaped Hermes config payloads. */
function RawList({ data, empty }: { data: unknown; empty: string }): React.JSX.Element {
  const items: { name: string; detail?: string; enabled?: boolean }[] = [];
  const scan = (arr: unknown[]): void => {
    for (const it of arr.slice(0, 40)) {
      if (typeof it === 'string') items.push({ name: it });
      else if (it && typeof it === 'object') {
        const o = it as Record<string, unknown>;
        items.push({
          name: String(o.name ?? o.id ?? o.title ?? 'item'),
          detail: typeof o.description === 'string' ? o.description : undefined,
          enabled: typeof o.enabled === 'boolean' ? o.enabled : undefined,
        });
      }
    }
  };
  if (Array.isArray(data)) scan(data);
  else if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        scan(v);
        break;
      }
    }
  }
  if (items.length === 0) return <div className="view-sub" style={{ marginTop: 0 }}>{empty}</div>;
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="toggle-row">
          <div>
            <div className="tr-title">{it.name}</div>
            {it.detail ? <div className="tr-desc">{it.detail}</div> : null}
          </div>
          {it.enabled !== undefined ? (
            <span className={`status-pill ${it.enabled ? 'ok' : 'muted'}`}>{it.enabled ? 'enabled' : 'off'}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ModelPicker({
  profile,
  config,
  currentModel,
  currentProvider,
}: {
  profile: string;
  config: ProfileConfig | null;
  currentModel?: string;
  currentProvider?: string;
}): React.JSX.Element {
  const reportError = useStore((s) => s.reportError);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  // Hermes answers with providers, each carrying its own model list; a
  // provider without credentials cannot run, so it is shown but unselectable.
  const opts = config?.modelOptions as ModelOptions | undefined;
  const groups = (opts?.providers ?? []).filter((p) => p.models.length > 0);
  const options = groups.flatMap((p) =>
    p.models.map((m) => ({ provider: p.slug, model: m, authenticated: p.authenticated })),
  );

  const current = `${currentProvider ?? ''}/${currentModel ?? ''}`;

  if (options.length === 0) {
    return <div className="view-sub" style={{ marginTop: 0 }}>Current: {current}. Model options unavailable from this Hermes version.</div>;
  }

  return (
    <div className="field">
      <label>Model (current: {current})</label>
      <select
        disabled={busy}
        value={current}
        onChange={(e) => {
          const opt = options.find((o) => `${o.provider}/${o.model}` === e.target.value);
          if (!opt) return;
          setBusy(true);
          void unwrap(api().bots.setModel(profile, opt.provider, opt.model))
            .then(() => toast('Model updated', `${opt.provider}/${opt.model}`))
            .catch((err) => reportError(err, 'Model change failed'))
            .finally(() => setBusy(false));
        }}
      >
        {!options.some((o) => `${o.provider}/${o.model}` === current) ? (
          <option value={current}>{current}</option>
        ) : null}
        {groups.map((g) => (
          <optgroup key={g.slug} label={g.authenticated ? g.name : `${g.name} — no credentials`}>
            {g.models.map((m) => (
              <option key={`${g.slug}/${m}`} value={`${g.slug}/${m}`} disabled={!g.authenticated}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
