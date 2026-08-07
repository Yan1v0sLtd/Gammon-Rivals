import {memo, type ReactNode} from "react"

type PlayerStatRowProps = {
  icon: "dice" | "score" | "cube",
  label: string,
  value: ReactNode,
  compact?: boolean,
}

const statClasses = {
  desktop: {
    row: {
      dice: "game-stat-row",
      score: "game-stat-row",
      cube: "game-stat-row",
    },
    icon: {
      dice: "game-stat-icon game-stat-icon--dice",
      score: "game-stat-icon game-stat-icon--score",
      cube: "game-stat-icon game-stat-icon--cube",
    },
  },
  compact: {
    row: "game-compact-stat-row",
    icon: {
      dice: "game-compact-stat-icon game-compact-stat-icon--dice",
      score: "game-compact-stat-icon game-compact-stat-icon--score",
      cube: "game-compact-stat-icon game-compact-stat-icon--cube",
    },
  },
} as const

export const PlayerStatRow = memo(function PlayerStatRow({
  icon,
  label,
  value,
  compact = false,
}: PlayerStatRowProps) {
  if (compact) {
    return (
      <div className={statClasses.compact.row}>
        <span className={statClasses.compact.icon[icon]}/>
        <span className="game-compact-stat-copy">
          <span>{label}</span>
          <strong>{value}</strong>
        </span>
      </div>
    )
  }

  return (
    <div className={statClasses.desktop.row[icon]}>
      <span className={statClasses.desktop.icon[icon]}/>
      <span className="game-stat-copy">
        <span className="game-stat-label">{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  )
})
