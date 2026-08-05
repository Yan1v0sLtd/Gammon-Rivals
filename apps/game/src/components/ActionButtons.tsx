type Props = {
  /** Show + enable the ROLL button. The big right-side action. */
  canRoll: boolean,
  onRoll: () => void,
  /** Show + enable the END-TURN button (replaces ROLL when there's
   *  nothing left to play but the turn isn't auto-ended). */
  canEndTurn: boolean,
  onEndTurn: () => void,
  /** Show + enable the UNDO button. Sits next to ROLL when relevant. */
  canUndo: boolean,
  onUndo: () => void,
}

/**
 * PRIMARY action control — Roll / Undo / End-turn. Rendered as the board's
 * `actionsOverlay`; CSS positions it as circular button(s) on the right-middle
 * of the board (see `.game-controls-primary` in index.css). The secondary
 * controls (Cube / Double / Auto) live in the local player's panel instead —
 * see {@link MatchSecondaryControls}.
 */
export function ActionButtons({
  canRoll,
  onRoll,
  canEndTurn,
  onEndTurn,
  canUndo,
  onUndo,
}: Props) {
  // The roll slot morphs through three single-button states plus a
  // fourth dual-button state for the last move:
  //   1. ROLL                — pre-roll, or dice settled but no move yet
  //                            (stays in place to anchor the action row).
  //   2. UNDO                — at least one move played, dice still remain.
  //   3. END TURN + UNDO     — all dice consumed / no legal moves left,
  //                            but the player should still be able to
  //                            undo the move that ended their turn.
  const showEndTurnPair = canEndTurn
  const rollSlotState: "roll" | "undo" = canUndo && !canEndTurn ? "undo" : "roll"
  const rollSlotDisabled = rollSlotState === "roll" && !canRoll
  const rollSlotOnClick = rollSlotState === "undo" ? onUndo : onRoll
  const rollSlotLabel = rollSlotState === "undo" ? "Undo last move" : "Roll the dice"

  return (<div className="game-action-row">
    {/* PRIMARY action — Roll / Undo / End-turn. Positioned by CSS as
          circular button(s) on the right-middle of the board. Text labels
          render inside the CSS circles. */}
    <div className="game-controls-primary">
      {showEndTurnPair ? (<div className="game-end-turn-pair">
        <button
          aria-label="Undo last move"
          className="game-end-turn-pair-button game-end-turn-pair-button--undo"
          disabled={!canUndo}
          type="button"
          onClick={canUndo ? onUndo : undefined}>
          <span>Undo</span>
        </button>
        <button
          aria-label="End turn"
          className="game-end-turn-pair-button game-end-turn-pair-button--end"
          type="button"
          onClick={onEndTurn}>
          <span>Done</span>
        </button>
      </div>) : (<button
        aria-label={rollSlotLabel}
        className={`game-roll-button game-roll-button--${rollSlotState}`}
        disabled={rollSlotDisabled}
        type="button"
        onClick={rollSlotDisabled ? undefined : rollSlotOnClick}>
        <span>{rollSlotState === "undo" ? "Undo" : "Roll"}</span>
      </button>)}
    </div>
  </div>)
}


