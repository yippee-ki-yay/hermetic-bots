/** Five-step New Bot wizard (spec §7.3): Identity, Persona, Capabilities,
 * Telegram, Review — with recoverable partial failure. */
import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { api, unwrap } from '../../app/api';
import { PersonaAvatar } from '../../components/shell/PersonaAvatar';
import { PersonaPicker } from './PersonaPicker';
import type { OrbDefinition, CreateBotStepResult } from '@shared/contracts';
import { AVATAR_PALETTES, JAR_SHAPES, EYE_STYLES, POSES, resolveAvatar } from '@shared/avatar';
import type { PublicError } from '@shared/errors';

const STEPS = ['Identity', 'Persona', 'Capabilities', 'Telegram', 'Review'] as const;

const SOUL_PRESETS: Record<string, string> = {
  'Chief of Staff': `# Role\nYou are a Chief of Staff persona: organized, direct, and protective of the operator's time.\n\n# Mission\nTurn scattered inputs into clear priorities, drafts, and follow-ups.\n\n# Working style\nShort, structured answers. Surface decisions, not summaries of process.\n\n# Boundaries\nNever send external messages without an explicit instruction.\n\n# Escalation rules\nFlag anything ambiguous or risky instead of guessing.\n\n# Output style\nBullet lists for status; prose for judgment calls.`,
  Researcher: `# Role\nYou are a Researcher persona: rigorous, skeptical, and thorough.\n\n# Mission\nProduce careful, sourced analysis and readable memos.\n\n# Working style\nState confidence levels. Separate evidence from interpretation.\n\n# Boundaries\nNever fabricate citations or data.\n\n# Escalation rules\nAsk before spending more than ~15 minutes on a dead end.\n\n# Output style\nMemos with headings; inline source notes.`,
  Operations: `# Role\nYou are an Operations persona: cautious, methodical, audit-friendly.\n\n# Mission\nKeep the server and scheduled routines healthy.\n\n# Working style\nPlan, show the plan, then act. Prefer dry runs.\n\n# Boundaries\nDestructive commands always go through approval.\n\n# Escalation rules\nStop and report on any unexpected system state.\n\n# Output style\nChecklists and exact command output snippets.`,
  Analyst: `# Role\nYou are an Analyst persona: numerate, precise, and conservative.\n\n# Mission\nRead reports, explain changes, and quantify uncertainty.\n\n# Working style\nShow the calculation. Distinguish observed from inferred.\n\n# Boundaries\nRead-only: never execute trades, sign, or submit transactions.\n\n# Escalation rules\nFlag data-quality problems before drawing conclusions.\n\n# Output style\nCompact tables and short verdicts.`,
};

interface WizardData {
  name: string;
  displayName: string;
  role: string;
  description: string;
  orb: OrbDefinition;
  /** Chosen picture, applied after the profile exists. */
  avatarDataUri?: string;
  startingPoint: 'blank' | 'clone';
  cloneFrom: string | null;
  soul: string;
  provider: string;
  model: string;
  workingDirNote: string;
  approvalMode: 'require-approval' | 'permissive';
  telegramToken: string;
  telegramMentionOnly: boolean;
  telegramAllowed: string;
  telegramSkipped: boolean;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function NewBotWizard({ step }: { step: number }): React.JSX.Element {
  const navigate = useStore((s) => s.navigate);
  const bots = useStore((s) => s.bots);
  const toast = useStore((s) => s.toast);
  const reportError = useStore((s) => s.reportError);
  const [data, setData] = useState<WizardData>(() => ({
    name: '',
    displayName: '',
    role: '',
    description: '',
    orb: { paletteId: AVATAR_PALETTES[0]!.id, seed: String(Date.now()) },
    startingPoint: 'blank',
    cloneFrom: null,
    soul: '',
    provider: 'grok',
    model: 'grok-4.5',
    workingDirNote: '',
    approvalMode: 'require-approval',
    telegramToken: '',
    telegramMentionOnly: true,
    telegramAllowed: '',
    telegramSkipped: false,
  }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{
    profileName?: string;
    steps: CreateBotStepResult[];
    telegram?: { ok: boolean; error?: PublicError };
  } | null>(null);

  const set = (patch: Partial<WizardData>): void => setData((d) => ({ ...d, ...patch }));

  // Seed off the profile name so the preview matches what gets created.
  const previewOrb = { ...data.orb, seed: data.name || data.orb.seed };
  const resolved = resolveAvatar(previewOrb);
  const go = (s: number): void => navigate({ view: 'wizard', step: s });

  const nameError = useMemo(() => {
    if (!data.name) return null;
    if (!NAME_RE.test(data.name)) return 'Use lowercase letters, digits, dot, dash, or underscore; start alphanumeric.';
    if (data.name.length > 64) return 'Keep it under 64 characters.';
    if (bots.some((b) => b.profileName === data.name)) return 'A profile with this name already exists.';
    return null;
  }, [data.name, bots]);

  const stepValid: boolean[] = [
    Boolean(data.name && !nameError && data.displayName.trim()),
    true,
    true,
    true,
    true,
  ];

  const riskFlags: string[] = [];
  if (data.approvalMode === 'permissive') {
    riskFlags.push('Permissive approvals combined with terminal or mutating tools lets this bot act on the server without asking. Recommended only for read-only personas.');
  }

  const create = async (): Promise<void> => {
    setCreating(true);
    setCreateResult(null);
    try {
      const result = await unwrap(
        api().bots.create({
          name: data.name,
          displayName: data.displayName.trim() || data.name,
          role: data.role.trim() || undefined,
          description: data.description.trim() || undefined,
          orb: { ...data.orb, seed: data.name },
          soul: data.soul.trim() || undefined,
          provider: data.provider || undefined,
          model: data.model || undefined,
          cloneFrom: data.startingPoint === 'clone' ? data.cloneFrom : null,
        }),
      );
      let telegram: { ok: boolean; error?: PublicError } | undefined;
      const profileCreated = result.steps.find((s) => s.step === 'profile')?.ok;
      // Local presentation data: apply once the profile exists, and never let
      // it fail the wizard.
      if (profileCreated && data.avatarDataUri) {
        try {
          await unwrap(api().avatar.set(data.name, data.avatarDataUri));
        } catch {
          toast('Bot created, but the picture could not be saved');
        }
      }
      if (profileCreated && !data.telegramSkipped && data.telegramToken.trim()) {
        try {
          await unwrap(
            api().telegram.configure({
              profileName: data.name,
              token: data.telegramToken.trim(),
              mentionOnly: data.telegramMentionOnly,
              allowedUsers: data.telegramAllowed
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              enabled: true,
            }),
          );
          telegram = { ok: true };
        } catch (err) {
          telegram = { ok: false, error: (err as { publicError?: PublicError }).publicError };
        }
        // Clear the token from renderer memory immediately (spec §6.5).
        set({ telegramToken: '' });
      }
      setCreateResult({ profileName: result.profileName, steps: result.steps, telegram });
      if (result.ok && (!telegram || telegram.ok)) {
        toast('Bot created', data.displayName);
        navigate({ view: 'chat', profile: data.name, sessionId: null });
      }
    } catch (err) {
      setCreateResult({
        steps: [{ step: 'profile', ok: false, error: (err as { publicError?: PublicError }).publicError }],
      });
    } finally {
      setCreating(false);
    }
  };

  const footer = (opts?: { nextLabel?: string; onNext?: () => void }): React.JSX.Element => (
    <div className="wizard-footer">
      <button className="btn ghost" onClick={() => (step === 0 ? navigate({ view: 'connection' }) : go(step - 1))}>
        {step === 0 ? 'Cancel' : 'Back'}
      </button>
      <button
        className="btn primary"
        disabled={!stepValid[step] || creating}
        onClick={() => (opts?.onNext ? opts.onNext() : go(step + 1))}
      >
        {opts?.nextLabel ?? 'Continue'}
      </button>
    </div>
  );

  return (
    <>
      {pickerOpen ? (
        <PersonaPicker
          onClose={() => setPickerOpen(false)}
          onPick={(persona, soul) => {
            setPickerOpen(false);
            // Seed identity too when the user hasn't filled it in yet — the
            // library entry usually has a better role line than a blank field.
            set({
              soul,
              role: data.role.trim() || persona.name,
              description: data.description.trim() || persona.description.slice(0, 300),
              displayName: data.displayName.trim() || persona.name,
            });
            toast('Persona inserted', persona.name);
          }}
        />
      ) : null}
      <aside className="wizard-rail" aria-label="Wizard steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={`wizard-step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => i < step && go(i)}
            disabled={i > step}
          >
            <span className="num">{i < step ? '✓' : i + 1}</span>
            {label}
          </button>
        ))}
      </aside>
      <main className="workspace">
        <div className="cmd-header">
          <div className="crumb">
            <div className="crumb-path">New bot<span className="sep">/</span>{STEPS[step]}</div>
          </div>
        </div>
        <div className="center-view">
          <div className="center-col">
            {step === 0 ? (
              <>
                <div className="view-title">Identity</div>
                <div className="card">
                  <div className="field-row">
                    <div className="field">
                      <label>Profile name (canonical, filesystem-safe)</label>
                      <input
                        type="text"
                        value={data.name}
                        placeholder="researcher"
                        spellCheck={false}
                        onChange={(e) => set({ name: e.target.value.toLowerCase() })}
                      />
                      {nameError ? <div className="err">{nameError}</div> : (
                        <div className="hint">Stays stable after creation; the display name below can change freely.</div>
                      )}
                    </div>
                    <div className="field">
                      <label>Display name</label>
                      <input
                        type="text"
                        value={data.displayName}
                        placeholder="Researcher"
                        onChange={(e) => set({ displayName: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>Role / title</label>
                    <input type="text" value={data.role} placeholder="Deep research" onChange={(e) => set({ role: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Short description</label>
                    <textarea value={data.description} onChange={(e) => set({ description: e.target.value })} />
                  </div>
                </div>
                <div className="card">
                  <h3>Picture</h3>
                  <div className="orb-editor">
                    <div className="orb-preview">
                      <PersonaAvatar orb={previewOrb} size={84} avatar={data.avatarDataUri} />
                    </div>
                    <div className="orb-controls">
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn"
                          onClick={async () => {
                            try {
                              const picked = await unwrap(api().avatar.pick());
                              if (picked) set({ avatarDataUri: picked });
                            } catch (err) {
                              reportError(err, 'Could not read that image');
                            }
                          }}
                        >
                          {data.avatarDataUri ? 'Change picture' : 'Upload picture'}
                        </button>
                        {data.avatarDataUri ? (
                          <button className="btn ghost" onClick={() => set({ avatarDataUri: undefined })}>
                            Use drawn avatar
                          </button>
                        ) : null}
                      </div>
                      <div className="hint">
                        Optional. Without a picture the bot gets the drawn avatar below, which
                        stays unique per bot.
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="card"
                  style={data.avatarDataUri ? { opacity: 0.55 } : undefined}
                >
                  <h3>Drawn avatar</h3>
                  <div className="orb-editor">
                    <div className="orb-preview">
                      <PersonaAvatar orb={previewOrb} size={84} />
                    </div>
                    <div className="orb-controls">
                      <div className="swatch-row" role="radiogroup" aria-label="Avatar colour">
                        {AVATAR_PALETTES.map((p) => (
                          <button
                            key={p.id}
                            role="radio"
                            aria-checked={data.orb.paletteId === p.id}
                            aria-label={p.name}
                            title={p.name}
                            className={`swatch ${data.orb.paletteId === p.id ? 'on' : ''}`}
                            style={{ background: p.body }}
                            onClick={() => set({ orb: { ...data.orb, paletteId: p.id } })}
                          />
                        ))}
                      </div>
                      <div className="seg-row" role="radiogroup" aria-label="Jar shape">
                        {JAR_SHAPES.map((j) => (
                          <button
                            key={j}
                            role="radio"
                            aria-checked={resolved.jar === j}
                            className={resolved.jar === j ? 'on' : ''}
                            onClick={() => set({ orb: { ...data.orb, jar: j } })}
                          >
                            {j}
                          </button>
                        ))}
                      </div>
                      <div className="seg-row" role="radiogroup" aria-label="Eyes">
                        {EYE_STYLES.map((e) => (
                          <button
                            key={e}
                            role="radio"
                            aria-checked={resolved.eyes === e}
                            className={resolved.eyes === e ? 'on' : ''}
                            onClick={() => set({ orb: { ...data.orb, eyes: e } })}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <div className="seg-row" role="radiogroup" aria-label="Pose">
                        {POSES.map((po) => (
                          <button
                            key={po}
                            role="radio"
                            aria-checked={resolved.pose === po}
                            className={resolved.pose === po ? 'on' : ''}
                            onClick={() => set({ orb: { ...data.orb, pose: po } })}
                          >
                            {po}
                          </button>
                        ))}
                      </div>
                      <div className="hint">
                        Jar, eyes, and pose vary independently of colour, so two bots never rely on
                        hue alone to tell apart.
                      </div>
                    </div>
                  </div>
                </div>
                {footer()}
              </>
            ) : null}

            {step === 1 ? (
              <>
                <div className="view-title">Persona (SOUL)</div>
                <p className="view-sub">
                  Presets seed the editor once — they are visible starting text, not hidden prompts.
                  Suggested sections: Role, Mission, Working style, Boundaries, Escalation rules, Output style.
                </p>
                <div className="card">
                  <div className="preset-row">
                    <button className="btn primary" onClick={() => setPickerOpen(true)}>
                      Browse persona library…
                    </button>
                    {Object.keys(SOUL_PRESETS).map((p) => (
                      <button
                        key={p}
                        className="btn"
                        onClick={() => {
                          if (!data.soul.trim() || window.confirm('Replace the current SOUL text with this preset?')) {
                            set({ soul: SOUL_PRESETS[p] ?? '' });
                          }
                        }}
                      >
                        {p}
                      </button>
                    ))}
                    <button className="btn ghost" onClick={() => set({ soul: '' })}>
                      Custom / clear
                    </button>
                  </div>
                  <textarea
                    className="soul-editor"
                    value={data.soul}
                    spellCheck={false}
                    placeholder={'# Role\n…'}
                    onChange={(e) => set({ soul: e.target.value })}
                    aria-label="SOUL editor"
                  />
                  <div className="count-line">
                    {data.soul.length.toLocaleString()} chars · ~{Math.ceil(data.soul.length / 4).toLocaleString()} tokens
                  </div>
                </div>
                {footer()}
              </>
            ) : null}

            {step === 2 ? (
              <>
                <div className="view-title">Capabilities</div>
                <div className="card">
                  <h3>Provider &amp; model</h3>
                  <div className="field-row">
                    <div className="field">
                      <label>Provider</label>
                      <input type="text" value={data.provider} onChange={(e) => set({ provider: e.target.value })} spellCheck={false} />
                      <div className="hint">This deployment currently uses Grok OAuth; no provider keys are entered here.</div>
                    </div>
                    <div className="field">
                      <label>Model</label>
                      <input type="text" value={data.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
                    </div>
                  </div>
                </div>
                <div className="card">
                  <h3>Approvals</h3>
                  <div className="radio-cards">
                    <button className={`radio-card ${data.approvalMode === 'require-approval' ? 'on' : ''}`} onClick={() => set({ approvalMode: 'require-approval' })}>
                      <div>
                        <div className="rc-title">Require approval for terminal and mutating tools (default)</div>
                        <div className="rc-desc">The bot pauses and asks before risky operations.</div>
                      </div>
                    </button>
                    <button className={`radio-card ${data.approvalMode === 'permissive' ? 'on' : ''}`} onClick={() => set({ approvalMode: 'permissive' })}>
                      <div>
                        <div className="rc-title">Permissive</div>
                        <div className="rc-desc">Fewer interruptions; higher blast radius.</div>
                      </div>
                    </button>
                  </div>
                  {riskFlags.map((f, i) => (
                    <div key={i} className="risk-flag">⚠ {f}</div>
                  ))}
                </div>
                <div className="risk-flag">
                  Profiles isolate Hermes state (config, memory, sessions) — they do not isolate
                  server filesystem access. Tools, skills, and MCP servers are refined after creation
                  in the bot&apos;s Capabilities tab, driven by what this Hermes version supports.
                </div>
                {footer()}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="view-title">Telegram</div>
                <p className="view-sub">
                  Every persona needs its own unique Telegram bot token. Create one with Telegram&apos;s
                  BotFather, copy the token, and paste it below. The token goes straight from the app
                  core to Hermes and is never shown again.
                </p>
                <div className="card">
                  <div className="field">
                    <label>Bot token (from @BotFather)</label>
                    <input
                      type="password"
                      value={data.telegramToken}
                      autoComplete="off"
                      placeholder="123456789:AA…"
                      onChange={(e) => set({ telegramToken: e.target.value, telegramSkipped: false })}
                    />
                  </div>
                  <div className="toggle-row">
                    <div>
                      <div className="tr-title">Respond only when mentioned</div>
                      <div className="tr-desc">In groups, the bot stays silent unless @-mentioned.</div>
                    </div>
                    <button
                      className={`switch ${data.telegramMentionOnly ? 'on' : ''}`}
                      role="switch"
                      aria-checked={data.telegramMentionOnly}
                      aria-label="Mention only"
                      onClick={() => set({ telegramMentionOnly: !data.telegramMentionOnly })}
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Allowed users (comma-separated, optional)</label>
                    <input
                      type="text"
                      value={data.telegramAllowed}
                      placeholder="your_username"
                      spellCheck={false}
                      onChange={(e) => set({ telegramAllowed: e.target.value })}
                    />
                  </div>
                </div>
                <div className="wizard-footer">
                  <button className="btn ghost" onClick={() => go(step - 1)}>
                    Back
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => { set({ telegramSkipped: true, telegramToken: '' }); go(4); }}>
                      Set up later
                    </button>
                    <button className="btn primary" onClick={() => go(4)}>
                      Continue
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <div className="view-title">Review</div>
                <div className="card">
                  <dl className="kv-list">
                    <dt>Profile</dt>
                    <dd className="mono">{data.name}</dd>
                    <dt>Display name</dt>
                    <dd>{data.displayName}{data.role ? ` — ${data.role}` : ''}</dd>
                    <dt>Starting point</dt>
                    <dd>{data.startingPoint === 'clone' ? `Clone of ${data.cloneFrom}` : 'Blank'}</dd>
                    <dt>Model</dt>
                    <dd className="mono">{data.provider} / {data.model}</dd>
                    <dt>SOUL</dt>
                    <dd>{data.soul.trim() ? `${data.soul.length.toLocaleString()} characters` : 'default'}</dd>
                    <dt>Approvals</dt>
                    <dd>{data.approvalMode === 'require-approval' ? 'Required for terminal & mutations' : 'Permissive'}</dd>
                    <dt>Telegram</dt>
                    <dd>{data.telegramSkipped || !data.telegramToken ? 'Set up later' : 'Token provided; will configure after creation'}</dd>
                  </dl>
                  {riskFlags.map((f, i) => (
                    <div key={i} className="risk-flag">⚠ {f}</div>
                  ))}
                </div>
                {createResult ? (
                  <div className="card">
                    <h3>Creation progress</h3>
                    {createResult.steps.map((s) => (
                      <div key={s.step} className={`step-status ${s.ok ? 'ok' : 'fail'}`}>
                        {s.ok ? '✓' : '✕'} {s.step === 'profile' ? 'Create Hermes profile' : s.step === 'soul' ? 'Write SOUL' : s.step === 'model' ? 'Set model' : s.step}
                        {s.error ? ` — ${s.error.message}` : ''}
                      </div>
                    ))}
                    {createResult.telegram ? (
                      <div className={`step-status ${createResult.telegram.ok ? 'ok' : 'fail'}`}>
                        {createResult.telegram.ok ? '✓' : '✕'} Configure Telegram
                        {createResult.telegram.error ? ` — ${createResult.telegram.error.message}` : ''}
                      </div>
                    ) : null}
                    {createResult.profileName && createResult.steps.some((s) => !s.ok || createResult.telegram?.ok === false) ? (
                      <p className="view-sub">
                        The profile <strong>{createResult.profileName}</strong> exists — nothing was rolled
                        back. Fix the failed steps from the bot&apos;s settings tabs, or retry below.
                      </p>
                    ) : null}
                    {createResult.profileName ? (
                      <div className="row-actions">
                        <button className="btn" onClick={() => navigate({ view: 'bot-settings', profile: createResult.profileName!, tab: 'overview' })}>
                          Open bot settings
                        </button>
                        <button className="btn primary" onClick={() => navigate({ view: 'chat', profile: createResult.profileName!, sessionId: null })}>
                          Start first thread
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {footer({ nextLabel: creating ? 'Creating…' : 'Create bot', onNext: () => void create() })}
              </>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
