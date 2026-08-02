interface Props {
  /** Show + enable the ROLL button. The big right-side action. */
  canRoll: boolean;
  onRoll: () => void;
  /** Show + enable the END-TURN button (replaces ROLL when there's
   *  nothing left to play but the turn isn't auto-ended). */
  canEndTurn: boolean;
  onEndTurn: () => void;
  /** Show + enable the UNDO button. Sits next to ROLL when relevant. */
  canUndo: boolean;
  onUndo: () => void;
}

/**
 * PRIMARY action control — Roll / Undo / End-turn. Rendered as the board's
 * `actionsOverlay`; CSS positions it as circular button(s) on the right-middle
 * of the board (see `.game-controls-primary` in index.css). The secondary
 * controls (Cube / Double / Auto) live in the local player's panel instead —
 * see {@link MatchSecondaryControls}.
 */
export default function ActionButtons({
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
  const showEndTurnPair = canEndTurn;
  const rollSlotState: 'roll' | 'undo' = canUndo && !canEndTurn ? 'undo' : 'roll';
  const rollSlotDisabled = rollSlotState === 'roll' && !canRoll;
  const rollSlotOnClick = rollSlotState === 'undo' ? onUndo : onRoll;
  const rollSlotLabel = rollSlotState === 'undo' ? 'Undo last move' : 'Roll the dice';

  return (<div className="game-action-row">
    {/* PRIMARY action — Roll / Undo / End-turn. Positioned by CSS as
          circular button(s) on the right-middle of the board. Text labels
          render inside the CSS circles. */}
    <div className="game-controls-primary">
      {showEndTurnPair ? (<div className="game-end-turn-pair">
        <button
          type="button"
          onClick={canUndo ? onUndo : undefined}
          disabled={!canUndo}
          className="game-end-turn-pair-button game-end-turn-pair-button--undo"
          aria-label="Undo last move"
        >
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={onEndTurn}
          className="game-end-turn-pair-button game-end-turn-pair-button--end"
          aria-label="End turn"
        >
          <span>Done</span>
        </button>
      </div>) : (<button
        type="button"
        onClick={rollSlotDisabled ? undefined : rollSlotOnClick}
        disabled={rollSlotDisabled}
        className={`game-roll-button game-roll-button--${rollSlotState}`}
        aria-label={rollSlotLabel}
      >
        <span>{rollSlotState === 'undo' ? 'Undo' : 'Roll'}</span>
      </button>)}
    </div>
  </div>);
}

interface SecondaryProps {
  /** Show + enable the DOUBLE button. */
  canDouble: boolean;
  onDouble: () => void;
  cubeValue: number;
  /** Show the cube + double buttons. False for single-game (target=1)
   *  matches, where the cube is dead. Defaults true. */
  showCube?: boolean;
  /** Optional preference control (auto-roll toggle) rendered after Double. */
  autoRollSlot?: React.ReactNode;
}

/**
 * SECONDARY controls — Cube / ×2 Double / Auto. Rendered in the LOCAL
 * player's side panel via its `bottomSlot`, so they sit directly under that
 * player's details + turn timer (matching the reference layout). Anchored to
 * the panel DOM rather than positioned over the board, so they track the
 * panel across aspect ratios with no magic offsets.
 */
export function MatchSecondaryControls({
  canDouble,
  onDouble,
  cubeValue,
  showCube = true,
  autoRollSlot,
}: SecondaryProps) {
  const nextCube = cubeValue * 2;

  return (<div className="game-controls-secondary">
    {showCube && (<>
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
        className={`game-double-button ${canDouble ? 'is-enabled' : 'is-disabled'}`}
      >
        <strong>×{nextCube}</strong>
        <span>Double</span>
      </button>
    </>)}

    {autoRollSlot && <div className="game-auto-slot">{autoRollSlot}</div>}
  </div>);
}
