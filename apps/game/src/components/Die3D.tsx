import { forwardRef } from 'react';
import type { Die } from '@engine/types';
import DieFace from './DieFace';
import { DIE_SIZE, FACE_TARGET_ROTATION, FACE_TRANSFORMS } from './die3dConstants';

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
          return <DieFace key={face} face={face} transform={FACE_TRANSFORMS[face]} used={used} />;
        })}
      </div>
    </div>
  );
});

export default Die3D;
