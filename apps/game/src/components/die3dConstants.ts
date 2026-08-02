import type { Die } from '@engine/types';

export const PIPS: Record<Die, readonly number[]> = {
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
