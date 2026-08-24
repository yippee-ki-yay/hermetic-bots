/** Activity Strip: at most three concise live items. */
import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { Icon } from '../common/Icon';

export function ActivityStrip({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const events = useStore((s) => s.transcripts[sessionId]);

  const items = useMemo(() => {
    const list = events ?? [];
    const out: { id: string; label: string; attention: boolean; icon: 'wrench' | 'shield' | 'clock' }[] = [];
    for (let i = list.length - 1; i >= 0 && out.length < 3; i--) {
      const e = list[i]!;
      if (e.kind === 'tool' && e.status === 'running' && !out.some((o) => o.icon === 'wrench')) {
        out.push({ id: e.id, label: `${e.toolName} running`, attention: false, icon: 'wrench' });
      }
      if (
        (e.kind === 'approval' || e.kind === 'sudo' || e.kind === 'secret' || e.kind === 'clarify') &&
        e.decision === 'pending' &&
        !out.some((o) => o.id === e.id)
      ) {
        out.push({
          id: e.id,
          label:
            e.kind === 'approval'
              ? 'Approval pending'
              : e.kind === 'sudo'
                ? 'Sudo pending'
                : e.kind === 'secret'
                  ? 'Secret requested'
                  : 'Clarification needed',
          attention: true,
          icon: 'shield',
        });
      }
      if (e.kind === 'user' && (e.delivery === 'submitting' || e.delivery === 'delivery-unknown') && !out.some((o) => o.icon === 'clock')) {
        out.push({ id: e.id, label: e.delivery === 'submitting' ? 'Prompt queued' : 'Delivery unknown', attention: e.delivery === 'delivery-unknown', icon: 'clock' });
      }
    }
    return out.reverse();
  }, [events]);

  if (items.length === 0) return null;

  return (
    <div className="activity-strip" aria-label="Current activity">
      {items.map((item) => (
        <button
          key={item.id}
          className={`activity-item ${item.attention ? 'attention' : ''}`}
          onClick={() => {
            document.getElementById(`evt-${item.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }}
        >
          <Icon name={item.icon} size={13} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
