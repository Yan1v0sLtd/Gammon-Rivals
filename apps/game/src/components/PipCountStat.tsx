import {memo} from "react"

import {
  selectOpponentPipCount as selectGameplayOpponentPipCount,
  selectSelfPipCount as selectGameplaySelfPipCount,
} from "../features/gameplay/gameplaySelectors"
import {
  selectOpponentPipCount as selectOnlineOpponentPipCount,
  selectSelfPipCount as selectOnlineSelfPipCount,
} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {SeatProps} from "./panelTypes"
import {PlayerStatRow} from "./PlayerStatRow"

export const PipCountStat = memo(function PipCountStat({mode, seat, matchId, compact = false}: SeatProps) {
  const pipCount = useAppSelector((state) => mode === "hotseat"
    ? seat === "self" ? selectGameplaySelfPipCount(state) : selectGameplayOpponentPipCount(state)
    : seat === "self" ? selectOnlineSelfPipCount(state, matchId) : selectOnlineOpponentPipCount(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="dice"
      label="Pip Count"
      side={seat === "opponent" ? "left" : "right"}
      value={pipCount}/>
  )
})
