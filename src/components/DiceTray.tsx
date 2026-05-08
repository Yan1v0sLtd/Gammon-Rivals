import { useEffect, useMemo, useState } from 'react';
import type { Die, DiceRoll, Player } from '../engine/types';
import Die3D from './Die3D';

function diceToShow(
  roll: DiceRoll,
  remaining: readonly Die[]
): Array<{ value: Die; used: boolean }> {
  if (roll[0] === roll[1]) {
    const total = 4;
    const used = total - remaining.length;
    return Array.from({ length: total }, (_, i) => ({
      value: roll[0],
      used: i < used,
    }));
  }
  const remCopy = [...remaining];
  return ([roll[0], roll[1]] as const).map((v) => {
    const idx = remCopy.indexOf(v);
    if (idx >= 0) {
      remCopy.splice(idx, 1);
      return { value: v, used: false };
    }
    return { value: v, used: true };
  });
}

interface Props {
  turn: Player;
  roll: DiceRoll | null;
  remaining: readonly Die[];
  canRoll: boolean;
  canEndTurn: boolean;
  onRoll(): void;
  onEndTurn(): void;
}

export default function DiceTray({
  turn,
  roll,
  remaining,
  canRoll,
  canEndTurn,
  onRoll,
  onEndTurn,
}: Props) {
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    if (roll !== null) {
      setRolling(true);
      // Match Die3D's TOTAL_DURATION_MS so the static transform doesn't
      // interrupt the in-flight throw animation.
      const t = setTimeout(() => setRolling(false), 1500);
      return () => clearTimeout(t);
    }
  }, [roll]);

  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining]);

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        {roll === null ? (
          <button
            onClick={onRoll}
            disabled={!canRoll}
            className="pointer-events-auto px-7 py-3 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 font-display text-xl shadow-xl border-2 border-amber-700 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
          >
            {turn === 'white' ? 'White' : 'Black'} — Roll
          </button>
        ) : (
          <>
            <div className="flex gap-3 pointer-events-none">
              {dice.map((d, i) => (
                <Die3D key={i} value={d.value} used={d.used} rolling={rolling} index={i} />
              ))}
            </div>
            {canEndTurn && !rolling && (
              <button
                onClick={onEndTurn}
                className="pointer-events-auto px-5 py-2 rounded-md bg-amber-700/90 text-amber-50 font-medium shadow-md border border-amber-900 hover:brightness-110 active:scale-95 transition"
              >
                End turn
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
