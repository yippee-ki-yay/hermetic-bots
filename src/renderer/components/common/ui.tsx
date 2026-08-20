/** Small shared primitives: modal, confirm dialog, switch, context menu. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the dialog.
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  requireText,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this exact string to enable confirm (§9.5). */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const blocked = requireText !== undefined && typed !== requireText;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'danger solid' : 'primary'}`}
            disabled={blocked}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
      {requireText !== undefined ? (
        <div className="field" style={{ marginTop: 12 }}>
          <label>
            Type <strong style={{ color: 'var(--text-primary)' }}>{requireText}</strong> to confirm
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>
      ) : null}
    </Modal>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

export interface MenuItem {
  label: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  danger?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const clampedX = Math.min(x, window.innerWidth - 180);
  const clampedY = Math.min(y, window.innerHeight - items.length * 34 - 20);
  return (
    <div className="ctx-menu" style={{ left: clampedX, top: clampedY }} ref={ref} role="menu">
      {items.map((item, i) =>
        item.divider ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            className={item.danger ? 'danger' : ''}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

export function RelativeTime({ iso }: { iso: string }): React.JSX.Element {
  const label = formatRelative(iso);
  return <time dateTime={iso}>{label}</time>;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
