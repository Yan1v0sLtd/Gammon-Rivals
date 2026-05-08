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
}: Props) {
  const showRoll = canRoll;
  const showEndTurn = !canRoll && canEndTurn;
  const nextCube = cubeValue * 2;

  return (
    <div className="flex items-center justify-center gap-3 px-2">
      {canDouble && (
        <button
          onClick={onDouble}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-b from-sky-400 to-sky-600 text-sky-50 font-display tracking-wider text-sm sm:text-base shadow-lg border-2 border-sky-700 hover:brightness-110 active:scale-95 transition"
        >
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-sky-900/70 text-amber-200 font-mono text-xs border border-sky-300/40">
            ×{nextCube}
          </span>
          DOUBLE
        </button>
      )}

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
          className="px-7 py-2.5 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-50 font-display tracking-widest text-base sm:text-lg shadow-lg border-2 border-emerald-800 hover:brightness-110 active:scale-95 transition"
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
    </div>
  );
}
