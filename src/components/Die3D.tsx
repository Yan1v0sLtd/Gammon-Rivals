import { useEffect, useRef } from 'react';
import type { Die } from '../engine/types';

const PIPS: Record<Die, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const DIE_SIZE = 56;
const HALF = DIE_SIZE / 2;

// Each face's offset+rotation places it on one of the cube's six faces.
// Convention: face 1 faces +Z (camera) when the cube is unrotated.
const FACE_TRANSFORMS: Record<Die, string> = {
  1: `translateZ(${HALF}px)`,
  2: `rotateY(180deg) translateZ(${HALF}px)`,
  3: `rotateY(-90deg) translateZ(${HALF}px)`,
  4: `rotateY(90deg) translateZ(${HALF}px)`,
  5: `rotateX(-90deg) translateZ(${HALF}px)`,
  6: `rotateX(90deg) translateZ(${HALF}px)`,
};

// Cube rotation that brings each face to the camera. Inverse of FACE_TRANSFORMS.
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
  /** True while a fresh roll is animating — triggers the kinematic throw. */
  rolling: boolean;
  /** Per-die index lets us seed independent throws so dice don't move identically. */
  index: number;
}

const TOTAL_DURATION_MS = 1500;
// Trajectory phase fractions (sum < 1; rest is "settled"):
//   0.00 -> 0.45  fall (high gravity)
//   0.45 -> 0.55  first bounce up
//   0.55 -> 0.65  fall to surface
//   0.65 -> 0.72  second bounce up
//   0.72 -> 0.80  fall to surface
//   0.80 -> 0.95  micro-tumble + settle to face
//   0.95 -> 1.00  rest

interface Throw {
  startX: number;
  startY: number;
  startRotX: number;
  startRotY: number;
  startRotZ: number;
  midRotX: number; // total rotation accumulated by mid-flight
  midRotY: number;
  midRotZ: number;
  endX: number; // final resting offset from natural flex position
  endY: number;
  endRotX: number; // target rotation that shows the rolled face
  endRotY: number;
  endRotZ: number;
  bounce1Up: number; // peak height of first bounce (negative = up)
  bounce2Up: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function nearestEquivalent(current: number, target: number): number {
  const diff = (((target - current) % 360) + 540) % 360 - 180;
  return current + diff;
}

function generateThrow(index: number, value: Die): Throw {
  const target = FACE_TARGET_ROTATION[value];
  // Final rest: small random offset so each roll lands a bit different
  const endX = rand(-30, 30) + (index === 1 ? 6 : -6);
  const endY = rand(-6, 8);
  // Start: above and to one side of the rest position. Keep the throw inside
  // the board container (which has overflow-hidden for rounded corners).
  const startX = endX + rand(-140, 140);
  const startY = -rand(150, 200);
  // Rotations during flight: many full revolutions per axis with random sign
  const dir = () => (Math.random() < 0.5 ? -1 : 1);
  const totalSpinX = dir() * (720 + Math.floor(Math.random() * 720));
  const totalSpinY = dir() * (720 + Math.floor(Math.random() * 720));
  const totalSpinZ = dir() * (180 + Math.floor(Math.random() * 360));
  const startRotX = rand(-30, 30);
  const startRotY = rand(-30, 30);
  const startRotZ = rand(-15, 15);
  // End rotation that shows the rolled face. Z stays at 0 so the face is
  // axis-aligned at rest (no tilted dice).
  const endRotX = nearestEquivalent(startRotX + totalSpinX, target.x);
  const endRotY = nearestEquivalent(startRotY + totalSpinY, target.y);
  const endRotZ = nearestEquivalent(startRotZ + totalSpinZ, 0);
  // 70% of the way through total rotation by mid-flight (peak bounce 1)
  const midRotX = startRotX + totalSpinX * 0.55;
  const midRotY = startRotY + totalSpinY * 0.55;
  const midRotZ = startRotZ + totalSpinZ * 0.55;
  return {
    startX, startY, startRotX, startRotY, startRotZ,
    midRotX, midRotY, midRotZ,
    endX, endY, endRotX, endRotY, endRotZ,
    bounce1Up: rand(-90, -60),
    bounce2Up: rand(-35, -20),
  };
}

function tx(x: number, y: number, rx: number, ry: number, rz: number): string {
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg) rotateZ(${rz.toFixed(1)}deg)`;
}

function buildKeyframes(t: Throw): Keyframe[] {
  // Rotation interpolated linearly across the throw, settling to exact target by 90%.
  const rxAt = (frac: number) => t.startRotX + (t.endRotX - t.startRotX) * frac;
  const ryAt = (frac: number) => t.startRotY + (t.endRotY - t.startRotY) * frac;
  const rzAt = (frac: number) => t.startRotZ + (t.endRotZ - t.startRotZ) * frac;

  return [
    { offset: 0,    transform: tx(t.startX, t.startY, t.startRotX, t.startRotY, t.startRotZ), easing: 'cubic-bezier(0.42, 0, 1, 1)' },
    // Hits the surface (with full target X reached so dice land where they'll rest)
    { offset: 0.45, transform: tx(t.endX, t.endY, rxAt(0.45), ryAt(0.45), rzAt(0.45)),         easing: 'cubic-bezier(0, 0, 0.2, 1)' },
    // Bounce 1 up
    { offset: 0.55, transform: tx(t.endX, t.bounce1Up, rxAt(0.62), ryAt(0.62), rzAt(0.62)),    easing: 'cubic-bezier(0.42, 0, 1, 1)' },
    // Bounce 1 lands
    { offset: 0.65, transform: tx(t.endX, t.endY, rxAt(0.78), ryAt(0.78), rzAt(0.78)),         easing: 'cubic-bezier(0, 0, 0.2, 1)' },
    // Bounce 2 up
    { offset: 0.72, transform: tx(t.endX, t.bounce2Up, rxAt(0.86), ryAt(0.86), rzAt(0.86)),    easing: 'cubic-bezier(0.42, 0, 1, 1)' },
    // Bounce 2 lands
    { offset: 0.80, transform: tx(t.endX, t.endY, rxAt(0.93), ryAt(0.93), rzAt(0.93)),         easing: 'cubic-bezier(0, 0, 0.3, 1)' },
    // Settle on face
    { offset: 0.95, transform: tx(t.endX, t.endY, t.endRotX, t.endRotY, t.endRotZ),            easing: 'ease-out' },
    { offset: 1.00, transform: tx(t.endX, t.endY, t.endRotX, t.endRotY, t.endRotZ) },
  ];
}

export default function Die3D({ value, used, rolling, index }: Props) {
  const cubeRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<Animation | null>(null);
  const restRef = useRef<{ x: number; y: number; rx: number; ry: number; rz: number }>({
    x: 0, y: 0,
    rx: FACE_TARGET_ROTATION[value].x,
    ry: FACE_TARGET_ROTATION[value].y,
    rz: 0,
  });

  useEffect(() => {
    const el = cubeRef.current;
    if (!el) return;

    if (rolling) {
      const throwParams = generateThrow(index, value);
      animRef.current?.cancel();
      const anim = el.animate(buildKeyframes(throwParams), {
        duration: TOTAL_DURATION_MS,
        fill: 'forwards',
        easing: 'linear',
      });
      animRef.current = anim;
      // Remember where we'll settle so the post-roll static state matches.
      restRef.current = {
        x: throwParams.endX,
        y: throwParams.endY,
        rx: throwParams.endRotX,
        ry: throwParams.endRotY,
        rz: throwParams.endRotZ,
      };
      return () => {
        anim.cancel();
      };
    }
    // Not rolling — apply the saved rest transform directly.
    el.style.transform = tx(
      restRef.current.x,
      restRef.current.y,
      restRef.current.rx,
      restRef.current.ry,
      restRef.current.rz
    );
  }, [rolling, value, index]);

  return (
    <div
      style={{
        width: DIE_SIZE,
        height: DIE_SIZE,
        perspective: 360,
        // Allow dice to render outside the natural flex bounds during the throw
        // without clipping to the dice tray container.
        overflow: 'visible',
      }}
    >
      <div
        ref={cubeRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transformStyle: 'preserve-3d',
          opacity: used ? 0.45 : 1,
          willChange: 'transform',
          // Initial transform (before any roll) — overridden by useEffect.
          transform: tx(
            restRef.current.x,
            restRef.current.y,
            restRef.current.rx,
            restRef.current.ry,
            restRef.current.rz
          ),
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
