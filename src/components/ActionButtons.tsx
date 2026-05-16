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
  const nextCube = cubeValue * 2;

  // The roll slot morphs through three single-button states plus a
  // fourth dual-button state for the last move:
  //   1. ROLL                — pre-roll, or dice settled but no move yet
  //                            (stays in place to anchor the action row).
  //   2. UNDO                — at least one move played, dice still remain.
  //   3. END TURN + UNDO     — all dice consumed / no legal moves left,
  //                            but the player should still be able to
  //                            undo the move that ended their turn.
  //                            Renders both buttons side by side, each
  //                            half the width of a single roll-slot
  //                            button so the row stays proportional.
  //
  // Text is baked into the assets, so the buttons have no children.
  const showEndTurnPair = canEndTurn;
  const rollSlotState: 'roll' | 'undo' = canUndo && !canEndTurn ? 'undo' : 'roll';
  const rollSlotDisabled = rollSlotState === 'roll' && !canRoll;
  const rollSlotOnClick = rollSlotState === 'undo' ? onUndo : onRoll;
  const rollSlotLabel =
    rollSlotState === 'undo' ? 'Undo last move' : 'Roll the dice';

  return (
    <div className="game-action-row">
      <button
        type="button"
        disabled
        className="game-cube-button"
        aria-label={`Cube value ${cubeValue}`}
      >
        <strong>{cubeValue}</strong>
        <span>Cube</span>
      </button>

      <button
        type="button"
        onClick={canDouble ? onDouble : undefined}
        disabled={!canDouble}
        className={`game-double-button ${
          canDouble
            ? 'is-enabled'
            : 'is-disabled'
        }`}
      >
        <strong>×{nextCube}</strong>
        <span>Double</span>
      </button>

      {showEndTurnPair ? (
        <div className="game-end-turn-pair">
          <button
            type="button"
            onClick={canUndo ? onUndo : undefined}
            disabled={!canUndo}
            className="game-end-turn-pair-button game-end-turn-pair-button--undo"
            aria-label="Undo last move"
          />
          <button
            type="button"
            onClick={onEndTurn}
            className="game-end-turn-pair-button game-end-turn-pair-button--end"
            aria-label="End turn"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={rollSlotDisabled ? undefined : rollSlotOnClick}
          disabled={rollSlotDisabled}
          className={`game-roll-button game-roll-button--${rollSlotState}`}
          aria-label={rollSlotLabel}
        />
      )}

      {autoRollSlot && <div className="game-auto-slot">{autoRollSlot}</div>}
    </div>
  );
}
