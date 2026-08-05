import {memo} from "react"

import {selectCurrentProfile, selectCurrentWallet, selectProfileProgression} from "../features/auth/authSelectors"
import {
  selectCubeValue as selectGameplayCubeValue,
  selectMatchTarget as selectGameplayMatchTarget,
  selectOpponentPipCount as selectGameplayOpponentPipCount,
  selectOpponentScore as selectGameplayOpponentScore,
  selectOpponentTimer as selectGameplayOpponentTimer,
  selectSelfPipCount as selectGameplaySelfPipCount,
  selectSelfScore as selectGameplaySelfScore,
  selectSelfTimer as selectGameplaySelfTimer,
} from "../features/gameplay/gameplaySelectors"
import {
  selectCubeValue as selectOnlineCubeValue,
  selectMatchTarget as selectOnlineMatchTarget,
  selectOpponentPipCount as selectOnlineOpponentPipCount,
  selectOpponentScore as selectOnlineOpponentScore,
  selectOpponentTimer as selectOnlineOpponentTimer,
  selectSpectatorOpponentPipCount,
  selectSpectatorSelfPipCount,
  selectSelfPipCount as selectOnlineSelfPipCount,
  selectSelfScore as selectOnlineSelfScore,
  selectSelfTimer as selectOnlineSelfTimer,
} from "../features/onlineMatch/onlineMatchSelectors"
import {formatCompactNumber} from "../lib/format"
import {getSessionGuestIdentity} from "../lib/identity"
import {useAppSelector} from "../store/hooks"

import {PlayerIdentityBlock, PlayerStatRow} from "./SidePanel"
import {TurnTimerBar} from "./TurnTimerBar"

export type PanelMode = "hotseat" | "online"
export type PanelSeat = "self" | "opponent"

type MatchProps = {
  readonly mode: PanelMode,
  readonly matchId?: string,
}

type SeatProps = MatchProps & {
  readonly seat: PanelSeat,
  readonly compact?: boolean,
}

export const SelfIdentityBlock = memo(function SelfIdentityBlock({compact = false}: {readonly compact?: boolean}) {
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)
  const identity = profile ? {
    name: profile.display_name,
    avatarSeed: profile.avatar_seed,
    avatarUrl: profile.avatar_url,
  } : getSessionGuestIdentity()
  const avatarSize = compact ? 58 : 106

  return (
    <PlayerIdentityBlock
      avatarSize={avatarSize}
      coinsLabel={formatCompactNumber(wallet?.coins)}
      compact={compact}
      identity={identity}
      innerAvatarSize={Math.round(avatarSize * 0.66)}
      level={progression.level}
      stateLabel={progression.statusLabel}
      textAlign="text-center"/>
  )
})

export const PipCountStat = memo(function PipCountStat({mode, seat, matchId, compact = false}: SeatProps) {
  const pipCount = useAppSelector((state) => mode === "hotseat"
    ? seat === "self" ? selectGameplaySelfPipCount(state) : selectGameplayOpponentPipCount(state)
    : seat === "self" ? selectOnlineSelfPipCount(state, matchId) : selectOnlineOpponentPipCount(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="dice"
      label="Pip Count"
      value={pipCount}/>
  )
})

export const SpectatorPipCountStat = memo(function SpectatorPipCountStat({matchId, seat, compact = false}: Omit<SeatProps, "mode">) {
  const pipCount = useAppSelector((state) => seat === "self"
    ? selectSpectatorSelfPipCount(state, matchId)
    : selectSpectatorOpponentPipCount(state, matchId))

  return (
    <PlayerStatRow
      compact={compact}
      icon="dice"
      label="Pip Count"
      value={pipCount}/>
  )
})

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
      value={`${score} / ${target}`}/>
  )
})

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
