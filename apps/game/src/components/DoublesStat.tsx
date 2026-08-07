import {memo} from "react"

import {selectCubeValue as selectGameplayCubeValue} from "../features/gameplay/gameplaySelectors"
import {selectCubeValue as selectOnlineCubeValue} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {SeatProps} from "./panelTypes"
import {PlayerStatRow} from "./PlayerStatRow"

export const DoublesStat = memo(function DoublesStat({mode, seat, matchId, compact = false}: SeatProps) {
  const value = useAppSelector((state) => mode === "hotseat" ? selectGameplayCubeValue(state) : selectOnlineCubeValue(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="cube"
      label="Doubles"
      side={seat === "opponent" ? "left" : "right"}
      value={value > 1 ? String(value) : "0"}/>
  )
})
