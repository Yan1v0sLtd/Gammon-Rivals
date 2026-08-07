import {memo} from "react"

import {
  selectMatchTarget as selectGameplayMatchTarget,
  selectOpponentScore as selectGameplayOpponentScore,
  selectSelfScore as selectGameplaySelfScore,
} from "../features/gameplay/gameplaySelectors"
import {
  selectMatchTarget as selectOnlineMatchTarget,
  selectOpponentScore as selectOnlineOpponentScore,
  selectSelfScore as selectOnlineSelfScore,
} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {SeatProps} from "./panelTypes"
import {PlayerStatRow} from "./PlayerStatRow"

export const ScoreStat = memo(function ScoreStat({mode, seat, matchId, compact = false}: SeatProps) {
  const score = useAppSelector((state) => mode === "hotseat"
    ? seat === "self" ? selectGameplaySelfScore(state) : selectGameplayOpponentScore(state)
    : seat === "self" ? selectOnlineSelfScore(state, matchId) : selectOnlineOpponentScore(state, matchId))
  const target = useAppSelector((state) => mode === "hotseat" ? selectGameplayMatchTarget(state) : selectOnlineMatchTarget(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="score"
      label="Score"
      side={seat === "opponent" ? "left" : "right"}
      value={`${score} / ${target}`}/>
  )
})
