import { useEffect, useRef, useState } from 'react';
import type { Die } from '../engine/types';

const PIPS: Record<Die, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// CSS translateZ requires a length unit — percentages are invalid for translateZ.
// Half the cube edge length is the offset that places each face on the cube's surface.
const DIE_SIZE = 56;
const HALF = DIE_SIZE / 2;

// Each face is rotated to a different position on the cube.
// Convention: face 1 faces +Z (camera) when the cube is unrotated.
const FACE_TRANSFORMS: Record<Die, string> = {
  1: `translateZ(${HALF}px)`,
  2: `rotateY(180deg) translateZ(${HALF}px)`,
  3: `rotateY(-90deg) translateZ(${HALF}px)`,
  4: `rotateY(90deg) translateZ(${HALF}px)`,
  5: `rotateX(-90deg) translateZ(${HALF}px)`,
  6: `rotateX(90deg) translateZ(${HALF}px)`,
};

const FACE_TARGET_ROTATION: Record<Die, { x: number; y: number }> = {
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
  /** True while a fresh roll is animating; the dice tumble during this window. */
  rolling: boolean;
  /** Used to seed unique tumble rotations per render so dice don't all spin the same. */
  index: number;
}

export default function Die3D({ value, used, rolling, index }: Props) {
  const target = FACE_TARGET_ROTATION[value];
  const [rotation, setRotation] = useState(target);
  const lastValueRef = useRef<Die>(value);

  // When the rolling flag flips on, choose a tumble rotation; when it flips off,
  // settle on the target. We add full revolutions so the animation feels like
  // a real tumble rather than a snap.
  useEffect(() => {
    if (rolling) {
      // Random extra spins (between 2 and 4 full turns) plus per-die offset.
      const spins = 2 + Math.floor(Math.random() * 3);
      const spinX = spins * 360 + Math.floor(Math.random() * 360);
      const spinY = spins * 360 + Math.floor(Math.random() * 360);
      setRotation({
        x: target.x + spinX + index * 45,
        y: target.y + spinY + index * 30,
      });
    } else {
      // Settle: snap modulo 360 around target so we don't keep accumulating.
      // Pick the closest rotation to current that lands at target visually.
      setRotation((prev) => {
        const settledX = nearestEquivalentAngle(prev.x, target.x);
        const settledY = nearestEquivalentAngle(prev.y, target.y);
        return { x: settledX, y: settledY };
      });
    }
    lastValueRef.current = value;
  }, [rolling, value, target.x, target.y, index]);

  return (
    <div
      className="die3d-perspective"
      style={{
        width: DIE_SIZE,
        height: DIE_SIZE,
        perspective: 320,
      }}
    >
      <div
        className="die3d-cube"
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          transition: rolling
            ? 'transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1.05)'
            : 'transform 380ms cubic-bezier(0.2, 0.8, 0.2, 1.05)',
          opacity: used ? 0.45 : 1,
        }}
      >
        {(Object.keys(FACE_TRANSFORMS) as Array<`${Die}`>).map((k) => {
          const face = Number(k) as Die;
          return <Face key={face} face={face} transform={FACE_TRANSFORMS[face]} used={used} />;
        })}
      </div>
    </div>
  );
}

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
        boxShadow: 'inset 0 -4px 8px rgba(120, 84, 28, 0.35), inset 0 2px 4px rgba(255, 255, 255, 0.6)',
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
            boxShadow: positions.includes(i) && !used
              ? 'inset 0 1px 1px rgba(0, 0, 0, 0.5)'
              : 'none',
          }}
        />
      ))}
    </div>
  );
}

/** Find an angle close to `current` that's equivalent (mod 360) to `target`. */
function nearestEquivalentAngle(current: number, target: number): number {
  const diff = ((target - current) % 360 + 540) % 360 - 180;
  return current + diff;
}
