import type { CubeValue, Player } from '@engine';

interface Props {
  offeredBy: Player;
  currentValue: CubeValue;
  onAccept(): void;
  onDrop(): void;
}

export default function CubeOfferDecision({ offeredBy, currentValue, onAccept, onDrop }: Props) {
  const opponent = offeredBy === 'white' ? 'black' : 'white';
  const newValue = currentValue * 2;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30">
      <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm">
        <div className="font-display text-lg uppercase tracking-wider mb-1">Double</div>
        <div className="text-xs mb-4 capitalize">
          {offeredBy} offers — {opponent}'s decision
        </div>

        <div className="my-3 inline-flex items-center justify-center w-20 h-20 rounded-lg bg-gradient-to-br from-amber-50 to-amber-200 border-2 border-amber-700 shadow-inner font-display text-3xl">
          {newValue}
        </div>

        <div className="text-xs mb-4 text-amber-900/80">
          Accept to play for <strong>{newValue}</strong>, or drop to forfeit{' '}
          <strong>{currentValue}</strong>.
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={onAccept}
            className="px-5 py-2 rounded-md bg-amber-700 text-amber-50 font-medium border border-amber-900 shadow hover:brightness-110 active:scale-95 transition"
          >
            Accept
          </button>
          <button
            onClick={onDrop}
            className="px-5 py-2 rounded-md bg-stone-700 text-stone-100 font-medium border border-stone-900 shadow hover:brightness-110 active:scale-95 transition"
          >
            Drop
          </button>
        </div>
      </div>
    </div>
  );
}
