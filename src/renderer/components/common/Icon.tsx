/** Single outline icon family, ~1.75px stroke (spec §8.5). */
interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export type IconName =
  | 'plus'
  | 'search'
  | 'send'
  | 'stop'
  | 'settings'
  | 'link'
  | 'chevron-down'
  | 'chevron-right'
  | 'terminal'
  | 'globe'
  | 'file'
  | 'wrench'
  | 'shield'
  | 'key'
  | 'x'
  | 'check'
  | 'alert'
  | 'clock'
  | 'more'
  | 'edit'
  | 'trash'
  | 'branch'
  | 'archive'
  | 'copy'
  | 'refresh'
  | 'slash'
  | 'paperclip'
  | 'bolt'
  | 'panel-open'
  | 'panel-close';

const PATHS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  // Paper plane pointing up-and-right, the usual "send" direction.
  send: 'M21 3 14 21l-3.5-7.5L3 10z M21 3 10.5 13.5',
  stop: 'M7 7h10v10H7z',
  settings:
    'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6',
  link: 'M10 14l4-4M8.5 17.5l-2 2a3.5 3.5 0 0 1-5-5l4-4M15.5 6.5l2-2a3.5 3.5 0 0 1 5 5l-4 4',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  globe:
    'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9s1.3-6.6 3.8-9z',
  file: 'M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8zM13 3v5h5',
  wrench:
    'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.1-2.1z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  key: 'M15 9a4 4 0 1 1-3.2 6.4L4 23l-1-1 1.5-1.5L6 19l1.5-1.5L9 16l1.6-1.6A4 4 0 0 1 15 9zM15.5 12.5l.01 0',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4l3 2',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  edit: 'M4 20l4-1L20 7l-3-3L5 16zM14 6l3 3',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5',
  branch: 'M7 4v9a4 4 0 0 0 4 4h6M17 13l3 4-3 4M7 4L4 7M7 4l3 3',
  archive: 'M4 7h16v3H4zM6 10v9h12v-9M10 14h4',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  slash: 'M16 4L8 20',
  paperclip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.5 17a1.7 1.7 0 0 1-2.4-2.4L15 7',
  bolt: 'M13 2L5 13h5l-1 9 8-11h-5z',
  'panel-open': 'M4 5h16v14H4zM10 5v14M13.5 9.5l2 2.5-2 2.5',
  'panel-close': 'M4 5h16v14H4zM10 5v14M7.5 9.5l-2 2.5 2 2.5',
};

export function Icon({ name, size = 18, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
