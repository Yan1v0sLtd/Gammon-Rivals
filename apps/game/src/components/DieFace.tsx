import type { Die } from '@engine/types';
import { PIPS } from './die3dConstants';

export default function DieFace({
  face,
  transform,
  used,
}: {
  face: Die;
  transform: string;
  used: boolean;
}) {
  const positions = PIPS[face];
  const pipColor = face === 1 || face === 4 ? '#d5483d' : '#331e18';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'linear-gradient(145deg, #fffaf4 0%, #f8e9ca 48%, #e1b46e 100%)',
        border: '3px solid #725349',
        borderRadius: 12,
        boxShadow:
          'inset 0 -6px 10px rgba(81, 50, 40, 0.28), inset 0 3px 5px rgba(255, 255, 255, 0.72), 0 0 0 1px rgba(255, 234, 170, 0.45)',
        transform,
        backfaceVisibility: 'hidden',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 3,
        padding: 7,
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
                : `radial-gradient(circle at 32% 30%, #fff4d6 0%, ${pipColor} 22%, #1a0e05 84%)`
              : 'transparent',
            boxShadow:
              positions.includes(i) && !used
                ? 'inset 0 2px 2px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.35)'
                : 'none',
          }}
        />
      ))}
    </div>
  );
}
