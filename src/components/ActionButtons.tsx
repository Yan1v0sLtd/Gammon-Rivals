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
    <div className="game-action-row">
      <button
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

      {canUndo && (
        <button
          onClick={onUndo}
          className="game-undo-button"
        >
          Undo
        </button>
      )}

      {showRoll && (
        <button
          onClick={onRoll}
          className="game-roll-button"
        >
          <strong>Roll</strong>
          <span>Roll the dice</span>
        </button>
      )}

      {showEndTurn && (
        <button
          onClick={onEndTurn}
          className="game-roll-button game-roll-button--end"
        >
          <strong>End Turn</strong>
          <span>No moves left</span>
        </button>
      )}

      {autoRollSlot && <div className="game-auto-slot">{autoRollSlot}</div>}
    </div>
  );
}
