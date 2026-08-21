/**
 * Bot roster rail: each persona's avatar paired with its name and job title,
 * plus global navigation (spec §7.1, with the expanded-roster layout requested
 * for v1 so identity reads at a glance rather than on hover).
 */
import { useStore } from '../../state/store';
import { PersonaAvatar } from './PersonaAvatar';
import { Icon } from '../common/Icon';
import { APP_NAME } from '@shared/branding';
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

  const activeProfile =
    route.view === 'chat' || route.view === 'bot-settings' ? route.profile : null;

  const connDotClass =
    connection?.status === 'online'
      ? 'online'
      : connection?.status === 'reconnecting' ||
          connection?.status === 'checking-hermes' ||
          connection?.status === 'starting-tunnel'
        ? 'reconnecting'
        : connection?.status === 'offline'
          ? 'offline'
          : 'idle';

  return (
    <nav className="rail" aria-label="Bots and navigation">
      <div className="rail-drag" />
      <div className="rail-brand">
        <span className="rail-monogram" aria-hidden="true">
          H
        </span>
        <span className="rail-brand-name">{APP_NAME}</span>
      </div>
      <div className="rail-section">Bots</div>
      <div className="rail-orbs" role="list">
        {bots.map((bot, i) => (
          <button
            key={bot.profileName}
            role="listitem"
            className={`orb-btn ${activeProfile === bot.profileName ? 'active' : ''}`}
            aria-label={`${bot.displayName}, ${statusLabel(bot)}`}
            aria-current={activeProfile === bot.profileName ? 'true' : undefined}
            title={i < 9 ? `${bot.displayName} (⌘${i + 1})` : bot.displayName}
            onClick={() => selectBot(bot.profileName)}
          >
            <span className="orb-figure">
              <PersonaAvatar orb={bot.orb} size={34} avatar={bot.avatarDataUri} />
              <span className={`orb-status ${statusClass(bot)}`} />
            </span>
            <span className="orb-meta">
              <span className="orb-name">{bot.displayName}</span>
              {bot.role || bot.model ? (
                <span className="orb-role">{bot.role ?? bot.model}</span>
              ) : null}
            </span>
            {bot.unreadCount > 0 ? <span className="orb-unread">{bot.unreadCount}</span> : null}
          </button>
        ))}
        <button className="rail-add" onClick={() => navigate({ view: 'wizard', step: 0 })}>
          <span className="rail-add-mark" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="8" opacity="0.4" strokeDasharray="3 4" />
              <path d="M12 8.5v7M8.5 12h7" />
            </svg>
          </span>
          New bot
        </button>
      </div>
      <div className="rail-bottom">
        <button
          className="rail-icon-btn"
          aria-label={`Connection: ${connection?.status ?? 'not configured'}`}
          onClick={() => navigate({ view: 'connection' })}
        >
          <span className="rail-icon-slot">
            <span className={`conn-dot ${connDotClass}`} />
          </span>
          <span className="rail-btn-label">{connection?.label ?? 'Connection'}</span>
        </button>
        <button
          className="rail-icon-btn"
          aria-label="Application settings"
          onClick={() => navigate({ view: 'settings' })}
        >
          <span className="rail-icon-slot">
            <Icon name="settings" size={17} />
          </span>
          <span className="rail-btn-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}
