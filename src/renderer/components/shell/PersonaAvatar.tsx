/**
 * Persona avatar: a crab in a sealed jar, ported from the Claude Design
 * source ("Hermetic Avatar.dc.html"). The template's `sc-if` branches become
 * conditional JSX; its colour and gaze props come from the resolved avatar.
 *
 * A user-supplied picture always wins over the drawn crab.
 */
import { useId } from 'react';
import type { OrbDefinition } from '@shared/contracts';
import { resolveAvatar, avatarBodyColor } from '@shared/avatar';

export { avatarBodyColor };

export function PersonaAvatar({
  orb,
  size = 42,
  title,
  avatar,
}: {
  orb: OrbDefinition;
  size?: number;
  title?: string;
  /** Local `data:` URI picture; replaces the drawn crab when present. */
  avatar?: string;
}): React.JSX.Element {
  // Unique per instance: the same bot renders at several sizes at once, and
  // duplicate gradient ids would make them share one paint server.
  const uid = useId().replace(/[:]/g, '');
  const gid = `hbAv${uid}`;
  const clipId = `hbClip${uid}`;

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={title ?? ''}
        width={size}
        height={size}
        draggable={false}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.28)',
        }}
      />
    );
  }

  const { palette: c, jar, eyes, pose, showBubbles, gaze: dx, gazeY: dy } = resolveAvatar(orb);
  const pupilY = 482 + dy;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      style={{ display: 'block', borderRadius: '50%' }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <radialGradient id={gid} cx="50%" cy="16%" r="82%">
          <stop offset="0%" stopColor={c.glow} stopOpacity="0.55" />
          <stop offset="62%" stopColor={c.glow} stopOpacity="0.16" />
          <stop offset="100%" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
        <clipPath id={clipId}>
          <circle cx="512" cy="512" r="512" />
        </clipPath>
      </defs>

      <circle cx="512" cy="512" r="512" fill={c.plate} />
      <circle cx="512" cy="512" r="512" fill={`url(#${gid})`} />

      <g clipPath={`url(#${clipId})`}>
        <ellipse cx="512" cy="852" rx="252" ry="34" fill="#04171C" opacity="0.4" />

        {/* --- Jar --------------------------------------------------------- */}
        {jar === 'bell' ? (
          <g>
            <rect x="497" y="140" width="30" height="60" rx="15" fill={c.rim} />
            <circle cx="512" cy="128" r="34" fill={c.rim} />
            <circle cx="512" cy="358" r="215" fill={c.dome} opacity="0.3" />
            <circle cx="512" cy="358" r="215" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <path d="M 372 300 Q 398 208 496 176" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="26" strokeLinecap="round" />
          </g>
        ) : null}

        {jar === 'cylinder' ? (
          <g>
            <rect x="362" y="210" width="300" height="376" rx="46" fill={c.dome} opacity="0.3" />
            <rect x="362" y="210" width="300" height="376" rx="46" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <rect x="336" y="166" width="352" height="52" rx="26" fill={c.rim} />
            <circle cx="512" cy="140" r="28" fill={c.rim} />
            <path d="M 404 520 L 404 268" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="26" strokeLinecap="round" />
          </g>
        ) : null}

        {jar === 'flask' ? (
          <g>
            <path d="M 322 578 C 322 424 400 380 400 306 L 400 252 L 624 252 L 624 306 C 624 380 702 424 702 578 Z" fill={c.dome} opacity="0.3" />
            <path d="M 322 578 C 322 424 400 380 400 306 L 400 252 L 624 252 L 624 306 C 624 380 702 424 702 578" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <rect x="382" y="212" width="260" height="48" rx="24" fill={c.rim} />
            <path d="M 366 536 C 366 438 434 396 434 320" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="24" strokeLinecap="round" />
          </g>
        ) : null}

        {jar === 'hex' ? (
          <g>
            <polygon points="512,152 700,266 700,490 512,604 324,490 324,266" fill={c.dome} opacity="0.3" />
            <polygon points="512,152 700,266 700,490 512,604 324,490 324,266" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" strokeLinejoin="round" />
            <circle cx="512" cy="122" r="30" fill={c.rim} />
            <path d="M 366 460 L 366 292 L 500 210" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}

        {jar === 'bulb' ? (
          <g>
            <rect x="466" y="430" width="92" height="72" fill={c.dome} opacity="0.3" />
            <circle cx="512" cy="300" r="155" fill={c.dome} opacity="0.3" />
            <circle cx="512" cy="300" r="155" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <path d="M 466 452 L 466 502" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <path d="M 558 452 L 558 502" fill="none" stroke={c.dome} strokeOpacity="0.7" strokeWidth="12" />
            <rect x="418" y="494" width="188" height="52" rx="26" fill={c.rim} />
            <circle cx="512" cy="118" r="28" fill={c.rim} />
            <path d="M 388 322 Q 398 232 476 196" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="24" strokeLinecap="round" />
          </g>
        ) : null}

        {showBubbles ? (
          <g fill="#FFFFFF" opacity="0.38">
            <circle cx="592" cy="300" r="17" />
            <circle cx="620" cy="346" r="9" />
            <circle cx="570" cy="368" r="6" />
          </g>
        ) : null}

        {/* --- Eyes (drawn inside the jar) --------------------------------- */}
        {eyes === 'stalks' ? (
          <g>
            <path d="M 466 620 L 458 512" fill="none" stroke={c.bodyDark} strokeWidth="24" strokeLinecap="round" />
            <path d="M 558 620 L 566 512" fill="none" stroke={c.bodyDark} strokeWidth="24" strokeLinecap="round" />
            <circle cx="456" cy="482" r="37" fill="#FFFFFF" />
            <circle cx="568" cy="482" r="37" fill="#FFFFFF" />
            <circle cx={456 + dx} cy={pupilY} r="16" fill="#17303A" />
            <circle cx={568 + dx} cy={pupilY} r="16" fill="#17303A" />
          </g>
        ) : null}

        {eyes === 'cyclops' ? (
          <g>
            <path d="M 512 626 L 512 508" fill="none" stroke={c.bodyDark} strokeWidth="28" strokeLinecap="round" />
            <circle cx="512" cy="462" r="52" fill="#FFFFFF" />
            <circle cx={512 + dx} cy={pupilY} r="23" fill="#17303A" />
            <circle cx="496" cy="440" r="9" fill="#FFFFFF" />
          </g>
        ) : null}

        {eyes === 'sleepy' ? (
          <g>
            <path d="M 466 620 L 458 512" fill="none" stroke={c.bodyDark} strokeWidth="24" strokeLinecap="round" />
            <path d="M 558 620 L 566 512" fill="none" stroke={c.bodyDark} strokeWidth="24" strokeLinecap="round" />
            <circle cx="456" cy="482" r="37" fill="#FFFFFF" />
            <circle cx="568" cy="482" r="37" fill="#FFFFFF" />
            <circle cx="456" cy="496" r="14" fill="#17303A" />
            <circle cx="568" cy="496" r="14" fill="#17303A" />
            <path d="M 419 482 A 37 37 0 0 1 493 482 Z" fill={c.bodyDark} />
            <path d="M 531 482 A 37 37 0 0 1 605 482 Z" fill={c.bodyDark} />
          </g>
        ) : null}

        {/* --- Legs -------------------------------------------------------- */}
        <g fill="none" stroke={c.bodyDark} strokeWidth="26" strokeLinecap="round">
          <path d="M 415 780 C 375 815 345 832 312 828" />
          <path d="M 468 800 C 435 840 408 862 375 860" />
          <path d="M 520 810 C 495 852 475 872 442 872" />
          <path d="M 609 780 C 649 815 679 832 712 828" />
          <path d="M 556 800 C 589 840 616 862 649 860" />
          <path d="M 504 810 C 529 852 549 872 582 872" />
        </g>

        {/* --- Left claw (always resting) ---------------------------------- */}
        <g>
          <path d="M 384 700 C 324 700 294 678 264 648" fill="none" stroke={c.bodyDark} strokeWidth="46" strokeLinecap="round" />
          <ellipse cx="194" cy="588" rx="80" ry="47" fill={c.body} transform="rotate(26 194 588)" />
          <ellipse cx="212" cy="656" rx="67" ry="39" fill={c.bodyDark} transform="rotate(-14 212 656)" />
        </g>

        {/* --- Right claw: resting or waving ------------------------------- */}
        {pose === 'rest' ? (
          <g>
            <path d="M 640 700 C 700 700 730 678 760 648" fill="none" stroke={c.bodyDark} strokeWidth="46" strokeLinecap="round" />
            <ellipse cx="830" cy="588" rx="80" ry="47" fill={c.body} transform="rotate(-26 830 588)" />
            <ellipse cx="812" cy="656" rx="67" ry="39" fill={c.bodyDark} transform="rotate(14 812 656)" />
          </g>
        ) : (
          <g>
            <path d="M 646 692 C 710 672 762 606 790 505" fill="none" stroke={c.bodyDark} strokeWidth="46" strokeLinecap="round" />
            <ellipse cx="796" cy="420" rx="80" ry="47" fill={c.body} transform="rotate(-86 796 420)" />
            <ellipse cx="852" cy="452" rx="67" ry="39" fill={c.bodyDark} transform="rotate(-46 852 452)" />
          </g>
        )}

        {/* --- Jar rim and shell ------------------------------------------- */}
        <rect x="352" y="540" width="320" height="66" rx="33" fill={c.rim} />
        <rect x="352" y="572" width="320" height="34" rx="17" fill={c.rimDark} opacity="0.85" />
        <ellipse cx="512" cy="700" rx="196" ry="126" fill={c.body} />
        <ellipse cx="464" cy="662" rx="88" ry="38" fill="#FFFFFF" opacity="0.2" />

        {/* Wide eyes sit on the shell, so they draw after it. */}
        {eyes === 'wide' ? (
          <g>
            <circle cx="452" cy="676" r="50" fill="#FFFFFF" />
            <circle cx="572" cy="676" r="50" fill="#FFFFFF" />
            <circle cx={452 + dx} cy={676 + dy} r="22" fill="#17303A" />
            <circle cx={572 + dx} cy={676 + dy} r="22" fill="#17303A" />
            <circle cx="438" cy="658" r="9" fill="#FFFFFF" />
            <circle cx="558" cy="658" r="9" fill="#FFFFFF" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
