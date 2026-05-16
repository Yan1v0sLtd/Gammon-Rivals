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

  // The roll slot is a single button that morphs through three states:
  //   1. ROLL      — pre-roll, or after the dice have settled but before
  //                  the player has moved (stays in place to anchor the
  //                  action row).
  //   2. UNDO      — the player has made at least one move and still has
  //                  dice left to play.
  //   3. END TURN  — the player has used all their dice (or has no
  //                  legal moves), so the turn needs to be ended.
  //
  // The button's background image is the only visual cue (the text is
  // baked into each asset), so we don't render any live label/sublabel.
  const rollSlotState: 'roll' | 'undo' | 'end' = canEndTurn
    ? 'end'
    : canUndo
    ? 'undo'
    : 'roll';
  const rollSlotDisabled = rollSlotState === 'roll' && !canRoll;
  const rollSlotOnClick =
    rollSlotState === 'end'
      ? onEndTurn
      : rollSlotState === 'undo'
      ? onUndo
      : onRoll;
  const rollSlotLabel =
    rollSlotState === 'end'
      ? 'End turn'
      : rollSlotState === 'undo'
      ? 'Undo last move'
      : 'Roll the dice';

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

      <button
        type="button"
        onClick={rollSlotDisabled ? undefined : rollSlotOnClick}
        disabled={rollSlotDisabled}
        className={`game-roll-button game-roll-button--${rollSlotState}`}
        aria-label={rollSlotLabel}
      />

      {autoRollSlot && <div className="game-auto-slot">{autoRollSlot}</div>}
    </div>
  );
}
