import {useEffect, useState} from 'react';
import type {CubeValue} from '../../../../packages/engine/src/match';
import type {Player} from '../../../../packages/engine/src/types';

interface Props {
  value: CubeValue;
  owner: Player | null;
  canOffer: boolean;
  pendingOffer: Player | null;

  onOffer(): void;
}

/**
 * Doubling cube on the left side rail. The "offer" gesture is two-tap with
 * an explicit confirmation button — single-tap offers caused accidental
 * doubles in similar games (Lord of the Board reviews flagged this).
 */
export default function DoublingCube({
  value,
  owner,
  canOffer,
  pendingOffer,
  onOffer,
}: Props) {
  const [confirming, setConfirming] = useState(false);

  // Auto-cancel confirm popover after 6s of no action
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);

  const ownerLabel = owner === null ? 'center' : owner === 'white' ? 'white owns' : 'black owns';

  const verticalAlign = owner === null ? 'items-center' : owner === 'white' ? 'items-end pb-4' : 'items-start pt-4';
  const isConfirming = confirming && canOffer && pendingOffer === null;

  return (<div
    className={`absolute left-0 top-0 bottom-0 w-[8%] sm:w-[7%] flex flex-col ${verticalAlign} justify-center pointer-events-none z-10`}
  >
    <div className="flex flex-col items-center gap-2 pointer-events-auto">
      <button
        onClick={() => canOffer && setConfirming((c) => !c)}
        disabled={!canOffer}
        aria-label={`Doubling cube — ${value}, ${ownerLabel}`}
        title={`Cube: ${value} (${ownerLabel})`}
        className={`relative w-10 h-10 sm:w-12 sm:h-12 rounded-md font-display text-base sm:text-xl shadow-lg border-2 transition
            ${canOffer ? 'bg-gradient-to-br from-amber-100 to-amber-300 text-amber-950 border-amber-700 hover:brightness-110 active:scale-95 cursor-pointer' : 'bg-gradient-to-br from-amber-200/90 to-amber-400/80 text-amber-950 border-amber-800/70 cursor-default'}
            ${pendingOffer !== null ? 'animate-pulse ring-2 ring-amber-400' : ''}`}
      >
        {value}
      </button>
      {isConfirming && (<div className="flex flex-col items-center gap-1">
        <button
          onClick={() => {
            onOffer();
            setConfirming(false);
          }}
          className="px-2 py-1 rounded text-[10px] sm:text-xs bg-amber-600 hover:bg-amber-500 text-amber-50 font-medium border border-amber-800 shadow"
        >
          Double → {value * 2}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] text-board-felt/60 hover:text-board-felt"
        >
          cancel
        </button>
      </div>)}
    </div>
  </div>);
}
