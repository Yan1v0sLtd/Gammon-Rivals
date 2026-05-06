import { useEffect, useMemo, useState } from 'react';
import type { Die, DiceRoll, Player } from '../engine/types';

const PIPS: Record<Die, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface DieFaceProps {
  value: Die;
  used: boolean;
  rolling: boolean;
}

function DieFace({ value, used, rolling }: DieFaceProps) {
  const [shown, setShown] = useState<Die>(value);

  useEffect(() => {
    if (rolling) {
      const id = setInterval(() => {
        setShown((Math.floor(Math.random() * 6) + 1) as Die);
      }, 70);
      return () => clearInterval(id);
    }
    setShown(value);
  }, [rolling, value]);

  const positions = PIPS[shown];
  return (
    <div
      className={`relative grid grid-cols-3 grid-rows-3 gap-[3px] p-[5px] w-12 h-12 rounded-lg shadow-md ${
        used
          ? 'bg-board-felt/30 border border-board-felt/20'
          : 'bg-gradient-to-br from-white to-board-felt/80 border border-amber-900/40'
      } ${rolling ? 'animate-[spin_0.5s_linear]' : ''}`}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          className={`rounded-full ${
            positions.includes(i)
              ? used
                ? 'bg-board-felt/40'
                : 'bg-amber-950'
              : ''
          }`}
        />
      ))}
    </div>
  );
}

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
      const t = setTimeout(() => setRolling(false), 500);
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
            <div className="flex gap-2 pointer-events-none">
              {dice.map((d, i) => (
                <DieFace key={i} value={d.value} used={d.used} rolling={rolling} />
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
