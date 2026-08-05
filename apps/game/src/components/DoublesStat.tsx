import {memo} from "react"

import {selectCubeValue as selectGameplayCubeValue} from "../features/gameplay/gameplaySelectors"
import {selectCubeValue as selectOnlineCubeValue} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {MatchProps} from "./panelTypes"
import {PlayerStatRow} from "./PlayerStatRow"

export const DoublesStat = memo(function DoublesStat({mode, matchId, compact = false}: MatchProps & {readonly compact?: boolean}) {
  const value = useAppSelector((state) => mode === "hotseat" ? selectGameplayCubeValue(state) : selectOnlineCubeValue(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="cube"
      label="Doubles"
      value={value > 1 ? String(value) : "0"}/>
  )
})
