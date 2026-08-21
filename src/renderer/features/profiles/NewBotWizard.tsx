/**
 * New bot: one screen, two decisions — a name and a role.
 *
 * Everything else is inferred: the avatar is derived from the profile name,
 * the provider/model come from whatever the server is authenticated for, and
 * Telegram is deliberately left for the bot's settings once it exists. The
 * five-step wizard the spec described (§7.3) collapsed to this because every
 * other field has a sane default and stays editable afterwards.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { PersonaAvatar } from '../../components/shell/PersonaAvatar';
import { PersonaPicker } from './PersonaPicker';
import type { CreateBotStepResult, ModelOptions } from '@shared/contracts';
import type { PublicError } from '@shared/errors';

/** Hermes profile names must be filesystem-safe; derive one from the label. */
export function slugify(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 64);
}

export function uniqueSlug(base: string, taken: string[]): string {
  if (!base) return '';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`.slice(0, 64);
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}

export function NewBotWizard(_props: { step: number }): React.JSX.Element {
  const navigate = useStore((s) => s.navigate);
  const bots = useStore((s) => s.bots);
  const toast = useStore((s) => s.toast);

  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [soul, setSoul] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [models, setModels] = useState<ModelOptions | null>(null);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState<CreateBotStepResult[] | null>(null);

  // The provider must be one the server holds credentials for; a hardcoded
  // slug previously produced bots that failed on their first prompt.
  useEffect(() => {
    void unwrap(api().models.options()).then(setModels).catch(() => undefined);
  }, []);

  const provider = useMemo(() => {
    if (!models) return undefined;
    return (
      models.providers.find((p) => p.slug === models.currentProvider) ??
      models.providers.find((p) => p.isCurrent && p.authenticated) ??
      models.providers.find((p) => p.authenticated)
    );
  }, [models]);

  const model = provider
    ? (provider.models.find((m) => m === models?.currentModel) ?? provider.models[0])
    : undefined;

  const profileName = useMemo(
    () => uniqueSlug(slugify(displayName), bots.map((b) => b.profileName)),
    [displayName, bots],
  );

  const nameError =
    displayName.trim() && !profileName
      ? 'Use at least one letter or digit so the profile has a usable name.'
      : null;

  const canCreate = Boolean(profileName) && !nameError && !creating;

  const create = async (): Promise<void> => {
    setCreating(true);
    setFailed(null);
    try {
      const result = await unwrap(
        api().bots.create({
          name: profileName,
          displayName: displayName.trim(),
          role: role.trim() || undefined,
          description: description.trim() || undefined,
          // An empty palette means "derive one from the seed", so the avatar
          // is chosen automatically and stays stable for this profile.
          orb: { paletteId: '', seed: profileName },
          soul: soul.trim() || undefined,
          provider: provider?.slug,
          model,
        }),
      );
      const profileStep = result.steps.find((s) => s.step === 'profile');
      if (!profileStep?.ok) {
        setFailed(result.steps);
        return;
      }
      const partial = result.steps.filter((s) => !s.ok);
      if (partial.length > 0) {
        // The profile exists; report what did not land rather than rolling back.
        setFailed(result.steps);
        toast('Bot created with warnings', partial.map((s) => s.step).join(', '));
      } else {
        toast('Bot created', displayName.trim());
      }
      navigate({ view: 'chat', profile: profileName, sessionId: null });
    } catch (err) {
      setFailed([
        { step: 'profile', ok: false, error: (err as { publicError?: PublicError }).publicError },
      ]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {pickerOpen ? (
        <PersonaPicker
          onClose={() => setPickerOpen(false)}
          onPick={(persona, pickedSoul) => {
            setPickerOpen(false);
            setSoul(pickedSoul);
            setPersonaName(persona.name);
            setRole(persona.name);
            setDescription(persona.description.slice(0, 300));
            if (!displayName.trim()) setDisplayName(persona.name);
          }}
        />
      ) : null}
      <main className="workspace">
        <div className="cmd-header">
          <div className="crumb">
            <div className="crumb-path">New bot</div>
          </div>
        </div>
        <div className="center-view">
          <div className="center-col" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <PersonaAvatar orb={{ paletteId: '', seed: profileName || 'new' }} size={56} />
              <div>
                <div className="view-title">Create a bot</div>
                <div className="view-sub" style={{ marginTop: 2 }}>
                  A name and a role is all it needs. Avatar, model, and Telegram are handled
                  afterwards in the bot&apos;s settings.
                </div>
              </div>
            </div>

            <div className="card">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  value={displayName}
                  placeholder="Marketing"
                  autoFocus
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                {nameError ? (
                  <div className="err">{nameError}</div>
                ) : profileName ? (
                  <div className="hint">
                    Hermes profile:{' '}
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{profileName}</span>
                  </div>
                ) : null}
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>Role</label>
                {personaName ? (
                  <div className="toggle-row" style={{ paddingTop: 4 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="tr-title">{personaName}</div>
                      <div className="tr-desc">{description || 'Persona from the library'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                      <button className="btn" onClick={() => setPickerOpen(true)}>
                        Change
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          setPersonaName('');
                          setSoul('');
                          setDescription('');
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={role}
                        placeholder="Growth marketing"
                        onChange={(e) => setRole(e.target.value)}
                      />
                      <button
                        className="btn"
                        style={{ flex: 'none' }}
                        onClick={() => setPickerOpen(true)}
                      >
                        Browse…
                      </button>
                    </div>
                    <div className="hint">
                      Type one, or pick from the persona library — a picked persona also fills in
                      the bot&apos;s instructions.
                    </div>
                  </>
                )}
              </div>
            </div>

            {models && !provider ? (
              <div className="risk-flag">
                ⚠ The server has no authenticated model provider, so this bot cannot answer until
                credentials are configured on the VPS.
              </div>
            ) : null}

            {failed ? (
              <div className="card">
                <h3>Creation result</h3>
                {failed.map((s) => (
                  <div key={s.step} className={`step-status ${s.ok ? 'ok' : 'fail'}`}>
                    {s.ok ? '✓' : '✕'} {s.step}
                    {s.error ? ` — ${s.error.message}` : ''}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => navigate({ view: 'connection' })}>
                Cancel
              </button>
              <button className="btn primary" disabled={!canCreate} onClick={() => void create()}>
                {creating ? 'Creating…' : 'Create bot'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
