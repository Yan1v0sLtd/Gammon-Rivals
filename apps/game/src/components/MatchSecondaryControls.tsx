type SecondaryProps = {
  /** Show + enable the DOUBLE button. */
  canDouble: boolean,
  onDouble: () => void,
  cubeValue: number,
  /** Show the cube + double buttons. False for single-game (target=1)
   *  matches, where the cube is dead. Defaults true. */
  showCube?: boolean,
  /** Optional preference control (auto-roll toggle) rendered after Double. */
  autoRollSlot?: React.ReactNode,
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
  const nextCube = cubeValue * 2

  return (<div className="game-controls-secondary">
    {showCube && (<>
      <button
        disabled
        aria-label={`Cube value ${cubeValue}`}
        className="game-cube-button"
        type="button">
        <strong>{cubeValue}</strong>
        <span>Cube</span>
      </button>

      <button
        className={`game-double-button ${canDouble ? "is-enabled" : "is-disabled"}`}
        disabled={!canDouble}
        type="button"
        onClick={canDouble ? onDouble : undefined}>
        <strong>×{nextCube}</strong>
        <span>Double</span>
      </button>
    </>)}

    {autoRollSlot && <div className="game-auto-slot">{autoRollSlot}</div>}
  </div>)
}
