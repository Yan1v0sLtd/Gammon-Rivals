import type {CubeValue} from "../../../../packages/engine/src/match"
import type {Player} from "../../../../packages/engine/src/types"

import styles from "./CubeOfferDecision.module.css"

type Props = {
  offeredBy: Player,
  currentValue: CubeValue,

  onAccept(): void,

  onDrop(): void,
}

export function CubeOfferDecision({
  offeredBy,
  currentValue,
  onAccept,
  onDrop,
}: Props) {
  const opponent = offeredBy === "white" ? "black" : "white"
  const newValue = currentValue * 2
  return (<div className={styles.overlay}>
    <div className={styles.card}>
      <div className={styles.title}>Double</div>
      <div className={styles.subtitle}>
        {offeredBy} offers — {opponent}'s decision
      </div>

      <div className={styles.cubeValue}>
        {newValue}
      </div>

      <div className={styles.body}>
        Accept to play for <strong>{newValue}</strong>, or drop to forfeit{" "}
        <strong>{currentValue}</strong>.
      </div>

      <div className={styles.actions}>
        <button
          className={styles.acceptButton}
          onClick={onAccept}>
          Accept
        </button>
        <button
          className={styles.dropButton}
          onClick={onDrop}>
          Drop
        </button>
      </div>
    </div>
  </div>)
}
