/** Constellation Rail (spec §7.1): persona orbs + global navigation. */
import { useState } from 'react';
import { useStore } from '../../state/store';
import { PersonaOrb } from './PersonaOrb';
import { Icon } from '../common/Icon';
import type { BotSummary } from '@shared/contracts';

function statusClass(bot: BotSummary): string {
  if (bot.runState === 'error') return 's-red';
  if (bot.runState === 'running') return 's-cyan';
  if (bot.runState === 'attention' || bot.gatewayState === 'degraded') return 's-amber';
  if (bot.gatewayState === 'online') return 's-green';
  return 's-muted';
}

function statusLabel(bot: BotSummary): string {
  if (bot.runState === 'error') return 'configuration error';
  if (bot.runState === 'running') return 'running';
  if (bot.runState === 'attention') return 'needs attention';
  if (bot.gatewayState === 'online') return 'healthy';
  return 'idle';
}

export function ConstellationRail(): React.JSX.Element {
  const bots = useStore((s) => s.bots);
  const route = useStore((s) => s.route);
  const connection = useStore((s) => s.connection);
  const selectBot = useStore((s) => s.selectBot);
  const navigate = useStore((s) => s.navigate);
  const [tooltip, setTooltip] = useState<{ bot: BotSummary; y: number } | null>(null);
  const [tipTimer, setTipTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const activeProfile =
    route.view === 'chat' || route.view === 'bot-settings' ? route.profile : null;

  const connDotClass =
    connection?.status === 'online'
      ? 'online'
      : connection?.status === 'reconnecting' || connection?.status === 'checking-hermes' || connection?.status === 'starting-tunnel'
        ? 'reconnecting'
        : connection?.status === 'offline'
          ? 'offline'
          : 'idle';

  return (
    <nav className="rail" aria-label="Bots and navigation">
      <div className="rail-drag" />
      <button
        className="rail-monogram"
        aria-label="Hermes Bots home"
        onClick={() => {
          const first = bots[0];
          if (first) selectBot(first.profileName);
        }}
      >
        H
      </button>
      <div className="rail-orbs" role="list">
        {bots.map((bot, i) => (
          <button
            key={bot.profileName}
            role="listitem"
            className={`orb-btn ${activeProfile === bot.profileName ? 'active' : ''}`}
            aria-label={`${bot.displayName}, ${statusLabel(bot)}`}
            aria-current={activeProfile === bot.profileName ? 'true' : undefined}
            title=""
            onClick={() => selectBot(bot.profileName)}
            onMouseEnter={(e) => {
              const y = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
              if (tipTimer) clearTimeout(tipTimer);
              setTipTimer(setTimeout(() => setTooltip({ bot, y }), 350));
            }}
            onMouseLeave={() => {
              if (tipTimer) clearTimeout(tipTimer);
              setTooltip(null);
            }}
            data-shortcut={i < 9 ? `⌘${i + 1}` : undefined}
          >
            <PersonaOrb orb={bot.orb} size={42} />
            <span className={`orb-status ${statusClass(bot)}`} />
          </button>
        ))}
        <button
          className="rail-add"
          aria-label="Add bot"
          onClick={() => navigate({ view: 'wizard', step: 0 })}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" opacity="0.4" strokeDasharray="3 4" />
            <path d="M12 8.5v7M8.5 12h7" />
          </svg>
        </button>
      </div>
      <div className="rail-bottom">
        <button
          className="rail-icon-btn"
          aria-label={`Connection: ${connection?.status ?? 'not configured'}`}
          onClick={() => navigate({ view: 'connection' })}
        >
          <span className={`conn-dot ${connDotClass}`} />
        </button>
        <button
          className="rail-icon-btn"
          aria-label="Application settings"
          onClick={() => navigate({ view: 'settings' })}
        >
          <Icon name="settings" size={19} />
        </button>
      </div>
      {tooltip ? (
        <div className="rail-tooltip" style={{ left: 92, top: tooltip.y }}>
          <div className="tt-name">{tooltip.bot.displayName}</div>
          {tooltip.bot.role ? <div className="tt-role">{tooltip.bot.role}</div> : null}
        </div>
      ) : null}
    </nav>
  );
}
