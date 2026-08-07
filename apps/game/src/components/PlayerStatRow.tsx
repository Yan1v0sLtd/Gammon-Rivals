import {memo, type ReactNode} from "react"

import styles from "./PlayerStatRow.module.css"

type PlayerStatRowProps = {
  icon: "dice" | "score" | "cube",
  label: string,
  value: ReactNode,
  compact?: boolean,
  side?: "left" | "right",
}

const statClasses = {
  desktop: {
    row: styles.row,
    icon: {
      dice: styles.iconDice,
      score: styles.iconScore,
      cube: styles.iconCube,
    },
  },
  compact: {
    row: styles.compactRow,
    icon: {
      dice: styles.compactIconDice,
      score: styles.compactIconScore,
      cube: "",
    },
  },
} as const

export const PlayerStatRow = memo(function PlayerStatRow({
  icon,
  label,
  value,
  compact = false,
  side = "left",
}: PlayerStatRowProps) {
  const sideClass = side === "right" ? styles.sideRight : ""

  if (compact) {
    return (
      <div className={`${statClasses.compact.row} ${sideClass}`}>
        <span className={`${styles.compactIcon} ${statClasses.compact.icon[icon]}`}/>
        <span className={styles.compactCopy}>
          <span>{label}</span>
          <strong>{value}</strong>
        </span>
      </div>
    )
  }

  return (
    <div className={`${statClasses.desktop.row} ${sideClass}`}>
      <span className={`${styles.icon} ${statClasses.desktop.icon[icon]}`}/>
      <span className={styles.copy}>
        <span className={styles.label}>{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  )
})
