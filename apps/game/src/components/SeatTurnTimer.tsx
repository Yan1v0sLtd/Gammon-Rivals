import {memo} from "react"

import {
  selectOpponentTimer as selectGameplayOpponentTimer,
  selectSelfTimer as selectGameplaySelfTimer,
} from "../features/gameplay/gameplaySelectors"
import {
  selectOpponentTimer as selectOnlineOpponentTimer,
  selectSelfTimer as selectOnlineSelfTimer,
} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {SeatProps} from "./panelTypes"
import {TurnTimerBar} from "./TurnTimerBar"

export const SeatTurnTimer = memo(function SeatTurnTimer({mode, seat, matchId, compact = false}: SeatProps) {
  const timer = useAppSelector((state) => mode === "hotseat"
    ? seat === "self" ? selectGameplaySelfTimer(state) : selectGameplayOpponentTimer(state)
    : seat === "self" ? selectOnlineSelfTimer(state, matchId) : selectOnlineOpponentTimer(state, matchId))

  // eslint-disable-next-line
  if (!timer || timer.deadlineMs === null || timer.durationMs === null) return null

  return (
    <TurnTimerBar
      compact={compact}
      deadlineMs={timer.deadlineMs}
      durationMs={timer.durationMs}
      side={seat === "opponent" ? "left" : "right"}/>
  )
})
