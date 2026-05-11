interface Props {
  /** Show + enable the ROLL button. The big right-side action. */
  canRoll: boolean;
  onRoll: () => void;
  /** Show + enable the END-TURN button (replaces ROLL when there's
   *  nothing left to play but the turn isn't auto-ended). */
  canEndTurn: boolean;
  onEndTurn: () => void;
  /** Show + enable the DOUBLE button. The smaller left-side action. */
  canDouble: boolean;
  onDouble: () => void;
  cubeValue: number;
  /** Show + enable the UNDO button. Sits next to ROLL when relevant. */
  canUndo: boolean;
  onUndo: () => void;
  /** Optional preference control rendered to the right of the primary action. */
  autoRollSlot?: React.ReactNode;
}

/**
 * Floating row of action buttons that sits at the bottom of the board.
 * The reference uses two prominent pills (DOUBLE on the left, ROLL on
 * the right); we mirror that, with UNDO appearing as a smaller pill
 * between them when the player has just made a move.
 */
export default function ActionButtons({
  canRoll,
  onRoll,
  canEndTurn,
  onEndTurn,
  canDouble,
  onDouble,
  cubeValue,
  canUndo,
  onUndo,
  autoRollSlot,
}: Props) {
  const showRoll = canRoll;
  const showEndTurn = !canRoll && canEndTurn;
  const nextCube = cubeValue * 2;

  return (
    <div className="flex max-w-full items-center justify-center gap-1.5 px-1 drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)] sm:gap-3 sm:px-2">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-amber-700 bg-gradient-to-br from-amber-100 to-amber-400 font-display text-base text-amber-950 shadow-[inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-3px_0_rgba(0,0,0,0.22)] sm:h-12 sm:w-12 sm:text-xl"
        aria-label={`Doubling cube value ${cubeValue}`}
        title={`Cube: ${cubeValue}`}
      >
        {cubeValue}
      </div>

      <button
        onClick={canDouble ? onDouble : undefined}
        disabled={!canDouble}
        className={`flex min-w-[6.8rem] items-center justify-center gap-1.5 rounded-full border-[3px] border-slate-950 bg-gradient-to-b from-cyan-200 via-sky-400 to-sky-700 px-2 py-2 text-sky-950 shadow-[inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-4px_0_rgba(0,0,0,0.35)] ring-2 ring-amber-500/70 transition sm:min-w-[10rem] sm:gap-2 sm:px-4 sm:py-2.5 ${
          canDouble
            ? 'hover:brightness-110 active:scale-95'
            : 'cursor-not-allowed opacity-55 grayscale'
        }`}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-200/70 bg-slate-900 text-amber-200 font-mono text-[10px] sm:h-8 sm:w-8 sm:text-xs">
          ×{nextCube}
        </span>
        <span className="font-display text-sm tracking-wider text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] sm:text-lg">
          DOUBLE
        </span>
      </button>

      {canUndo && (
        <button
          onClick={onUndo}
          className="px-3 py-2 rounded-full bg-stone-700/90 text-amber-50 font-display tracking-wider text-xs sm:text-sm shadow-md border border-stone-900 hover:brightness-110 active:scale-95 transition"
        >
          ↶ UNDO
        </button>
      )}

      {showRoll && (
        <button
          onClick={onRoll}
          className="min-w-[7.2rem] rounded-full border-[3px] border-slate-950 bg-gradient-to-b from-lime-200 via-lime-400 to-emerald-700 px-4 py-2 font-display text-lg tracking-widest text-slate-950 shadow-[inset_0_2px_0_rgba(255,255,255,0.75),inset_0_-4px_0_rgba(0,0,0,0.35)] ring-2 ring-lime-200/80 transition hover:brightness-110 active:scale-95 sm:min-w-[11rem] sm:px-7 sm:py-2.5 sm:text-2xl"
        >
          ROLL
        </button>
      )}

      {showEndTurn && (
        <button
          onClick={onEndTurn}
          className="px-6 py-2.5 rounded-full bg-gradient-to-b from-amber-500 to-amber-700 text-amber-50 font-display tracking-wider text-sm sm:text-base shadow-lg border-2 border-amber-900 hover:brightness-110 active:scale-95 transition"
        >
          END TURN
        </button>
      )}

      {autoRollSlot && <div className="shrink-0">{autoRollSlot}</div>}
    </div>
  );
}
