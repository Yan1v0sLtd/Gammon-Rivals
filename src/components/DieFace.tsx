import type { Die } from '../engine/types';

/**
 * Sprite-style die face rendered as inline SVG so it stays crisp at any
 * size and themes cleanly via CSS variables. Each value renders a fixed
 * SVG (one "sprite per value"), with the pip positions baked into the
 * SVG by index.
 *
 * If you later want bitmap sprites (designed PNG/WebP for each value),
 * swap this component for an <img src="/.../dice-${value}.webp" />.
 */

interface Props {
  value: Die;
  variant?: 'white' | 'dark';
}

// Pip coordinates on a 100×100 face, by grid index 0..8 (left→right,
// top→bottom). These match the engine's PIPS layout in DiceTray.
const PIP_COORDS: Record<number, [number, number]> = {
  0: [24, 24],
  1: [50, 24],
  2: [76, 24],
  3: [24, 50],
  4: [50, 50],
  5: [76, 50],
  6: [24, 76],
  7: [50, 76],
  8: [76, 76],
};

// Which 0..8 grid indices light up for each face value (mirrors
// DiceTray's PIPS map — kept here so DieFace is standalone).
const FACE_PIPS: Record<Die, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export default function DieFace({ value, variant = 'white' }: Props) {
  const pips = FACE_PIPS[value];
  const isWhite = variant === 'white';

  // Solid-ish IDs so two dice on the same page don't trample each other's
  // gradients (multiple dice render at once with the same value).
  const idSuffix = `${variant}-${value}`;
  const faceGradId = `die-face-${idSuffix}`;
  const pipGradId = `die-pip-${idSuffix}`;
  const innerShadowId = `die-inner-${idSuffix}`;

  return (
    <svg
      className="game-die-svg"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={faceGradId} x1="0" y1="0" x2="0" y2="1">
          {isWhite ? (
            <>
              <stop offset="0%" stopColor="#fffaf2" />
              <stop offset="55%" stopColor="#f5e3c2" />
              <stop offset="100%" stopColor="#d6b376" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#3a2c1c" />
              <stop offset="55%" stopColor="#1d140a" />
              <stop offset="100%" stopColor="#0a0604" />
            </>
          )}
        </linearGradient>

        <radialGradient id={pipGradId} cx="35%" cy="30%" r="70%">
          {isWhite ? (
            <>
              <stop offset="0%" stopColor="#5a4422" />
              <stop offset="55%" stopColor="#1a0e05" />
              <stop offset="100%" stopColor="#0a0502" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#fff6d6" />
              <stop offset="55%" stopColor="#f0c860" />
              <stop offset="100%" stopColor="#a67320" />
            </>
          )}
        </radialGradient>

        <filter id={innerShadowId} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Outer rim */}
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        rx="18"
        ry="18"
        fill={isWhite ? '#a07535' : '#5b3f1a'}
        opacity="0.85"
      />

      {/* Face */}
      <rect
        x="5"
        y="5"
        width="90"
        height="90"
        rx="15"
        ry="15"
        fill={`url(#${faceGradId})`}
      />

      {/* Subtle top highlight */}
      <rect
        x="9"
        y="8"
        width="82"
        height="34"
        rx="13"
        ry="13"
        fill={isWhite ? '#ffffff' : '#ffffff'}
        opacity={isWhite ? '0.35' : '0.08'}
      />

      {/* Inner bevel */}
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="14"
        ry="14"
        fill="none"
        stroke={isWhite ? 'rgba(255, 240, 200, 0.75)' : 'rgba(255, 222, 130, 0.32)'}
        strokeWidth="0.8"
      />

      {/* Pips */}
      {pips.map((idx) => {
        const [cx, cy] = PIP_COORDS[idx];
        return (
          <g key={idx}>
            {/* Pip shadow well */}
            <circle
              cx={cx}
              cy={cy + 1.2}
              r="9"
              fill={isWhite ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.55)'}
              filter={`url(#${innerShadowId})`}
            />
            {/* Pip body */}
            <circle cx={cx} cy={cy} r="8.5" fill={`url(#${pipGradId})`} />
            {/* Pip highlight */}
            <circle
              cx={cx - 2.4}
              cy={cy - 2.4}
              r="2.2"
              fill={isWhite ? 'rgba(255, 235, 175, 0.6)' : 'rgba(255, 252, 220, 0.7)'}
            />
          </g>
        );
      })}
    </svg>
  );
}
