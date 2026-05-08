import { forwardRef } from 'react';
import type { Die } from '../engine/types';

const PIPS: Record<Die, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export const DIE_SIZE = 56;
const HALF = DIE_SIZE / 2;

export const FACE_TRANSFORMS: Record<Die, string> = {
  1: `translateZ(${HALF}px)`,
  2: `rotateY(180deg) translateZ(${HALF}px)`,
  3: `rotateY(-90deg) translateZ(${HALF}px)`,
  4: `rotateY(90deg) translateZ(${HALF}px)`,
  5: `rotateX(-90deg) translateZ(${HALF}px)`,
  6: `rotateX(90deg) translateZ(${HALF}px)`,
};

export const FACE_TARGET_ROTATION: Record<Die, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 0, y: 180 },
  3: { x: 0, y: 90 },
  4: { x: 0, y: -90 },
  5: { x: 90, y: 0 },
  6: { x: -90, y: 0 },
};

interface Props {
  value: Die;
  used: boolean;
}

/**
 * Presentational 3D die. Position + rotation are driven by the parent's
 * physics loop via direct DOM transform writes on the forwarded ref —
 * this component never re-renders for animation frames.
 */
const Die3D = forwardRef<HTMLDivElement, Props>(function Die3D({ value, used }, ref) {
  const target = FACE_TARGET_ROTATION[value];
  return (
    <div
      style={{
        width: DIE_SIZE,
        height: DIE_SIZE,
        perspective: 360,
        overflow: 'visible',
      }}
    >
      <div
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transformStyle: 'preserve-3d',
          opacity: used ? 0.45 : 1,
          willChange: 'transform',
          transition: 'opacity 200ms ease',
          // Initial transform; the parent's physics loop overrides this on roll.
          transform: `translate3d(0px, 0px, 0px) rotateX(${target.x}deg) rotateY(${target.y}deg) rotateZ(0deg)`,
        }}
      >
        {(Object.keys(FACE_TRANSFORMS) as Array<`${Die}`>).map((k) => {
          const face = Number(k) as Die;
          return <Face key={face} face={face} transform={FACE_TRANSFORMS[face]} used={used} />;
        })}
      </div>
    </div>
  );
});

function Face({ face, transform, used }: { face: Die; transform: string; used: boolean }) {
  const positions = PIPS[face];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(160deg, #fffaf0 0%, #f0e1b0 100%)',
        border: '1.5px solid #6b4220',
        borderRadius: 8,
        boxShadow:
          'inset 0 -4px 8px rgba(120, 84, 28, 0.35), inset 0 2px 4px rgba(255, 255, 255, 0.6)',
        transform,
        backfaceVisibility: 'hidden',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 2,
        padding: 6,
        boxSizing: 'border-box',
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          style={{
            borderRadius: '50%',
            background: positions.includes(i)
              ? used
                ? '#bba87a'
                : 'radial-gradient(circle at 30% 30%, #5a3618 0%, #1a0e05 80%)'
              : 'transparent',
            boxShadow:
              positions.includes(i) && !used ? 'inset 0 1px 1px rgba(0, 0, 0, 0.5)' : 'none',
          }}
        />
      ))}
    </div>
  );
}

export default Die3D;
