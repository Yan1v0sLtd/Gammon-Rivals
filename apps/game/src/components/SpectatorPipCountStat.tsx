import {memo} from "react"

import {selectSpectatorOpponentPipCount, selectSpectatorSelfPipCount} from "../features/onlineMatch/onlineMatchSelectors"
import {useAppSelector} from "../store/hooks"

import type {SeatProps} from "./panelTypes"
import {PlayerStatRow} from "./PlayerStatRow"

export const SpectatorPipCountStat = memo(function SpectatorPipCountStat({matchId, seat, compact = false}: Omit<SeatProps, "mode">) {
  const pipCount = useAppSelector((state) => seat === "self"
    ? selectSpectatorSelfPipCount(state, matchId)
    : selectSpectatorOpponentPipCount(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="dice"
      label="Pip Count"
      side={seat === "opponent" ? "left" : "right"}
      value={pipCount}/>
  )
})
