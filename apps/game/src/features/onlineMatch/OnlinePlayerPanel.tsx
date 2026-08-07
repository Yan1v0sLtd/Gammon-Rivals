import {memo} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import type {Player} from "../../../../../packages/engine/src/types"
import {getProfileProgression, type ProfileRow} from "../../../../../packages/shared/src/progression"
import {AutoRollToggle} from "../../components/AutoRollToggle"
import {DoublesStat} from "../../components/DoublesStat"
import {MatchSecondaryControls} from "../../components/MatchSecondaryControls"
import {PipCountStat} from "../../components/PipCountStat"
import {PlayerIdentityBlock} from "../../components/PlayerIdentityBlock"
import {PlayerPanelShell} from "../../components/PlayerPanelShell"
import {PlayerStatRow} from "../../components/PlayerStatRow"
import {ScoreStat} from "../../components/ScoreStat"
import {SeatTurnTimer} from "../../components/SeatTurnTimer"
import {SelfIdentityBlock} from "../../components/SelfIdentityBlock"
import {SpectatorPipCountStat} from "../../components/SpectatorPipCountStat"
import {aiIdentityFromSeed, type PlayerIdentity} from "../../lib/identity"
import {useIsMobileLayout} from "../../lib/useMediaQuery"
import {useAppSelector} from "../../store/hooks"
import {selectLevelConfigs, selectLevelStatusTiers} from "../auth/authSelectors"
import {useGetProfileQuery} from "../playerData/playerDataApi"

import {
  selectCubeValue,
  selectEffectiveTurn,
  selectMatchFinished,
  selectBetweenGames,
  selectOpponentLevel,
  selectOpponentStateLabel,
  selectRemoteOpponentId,
  selectOpponentIsTurn,
  selectSelfIsTurn,
  selectMatchTarget,
  selectIsBot,
  selectOpponentId,
  selectOwnerId,
  selectSpectatorColor,
  selectSpectatorScore,
} from "./onlineMatchSelectors"

const EMPTY_CONFIGS = [] as const
const EMPTY_STATUS_TIERS = [] as const
const NOOP = () => undefined

export type OnlinePlayerPanelProps = {
  readonly matchId: string,
  readonly seat: "self" | "opponent",
  readonly isSpectator: boolean,
  readonly controlsVisible?: boolean,
  readonly canDouble?: boolean,
  readonly autoRollEnabled?: boolean,
  readonly onAutoRollChange?: (enabled: boolean) => void,
  readonly onDouble?: () => void,
}

function profileToIdentity(profile: ProfileRow | null): PlayerIdentity | null {
  return profile ? {
    name: profile.display_name,
    avatarSeed: profile.avatar_seed,
    avatarUrl: profile.avatar_url,
  } : null
}

export const OnlinePlayerPanel = memo(function OnlinePlayerPanel({
  matchId,
  seat,
  isSpectator,
  controlsVisible = false,
  canDouble = false,
  autoRollEnabled = false,
  onAutoRollChange,
  onDouble,
}: OnlinePlayerPanelProps) {
  const compact = useIsMobileLayout()
  const ownerId = useAppSelector((state) => selectOwnerId(state, matchId))
  const opponentId = useAppSelector((state) => selectOpponentId(state, matchId))
  const isBot = useAppSelector((state) => selectIsBot(state, matchId))
  const effectiveTurn = useAppSelector((state) => isSpectator ? selectEffectiveTurn(state, matchId) : null)
  const matchFinished = useAppSelector((state) => isSpectator ? selectMatchFinished(state, matchId) : false)
  const betweenGames = useAppSelector((state) => isSpectator ? selectBetweenGames(state, matchId) : false)
  const cubeValue = useAppSelector((state) => selectCubeValue(state, matchId))
  const target = useAppSelector((state) => selectMatchTarget(state, matchId))
  const pairedSelfTurn = useAppSelector((state) => isSpectator ? false : selectSelfIsTurn(state, matchId))
  const pairedOpponentTurn = useAppSelector((state) => isSpectator ? false : selectOpponentIsTurn(state, matchId))
  const opponentLevel = useAppSelector((state) => selectOpponentLevel(state, matchId))
  const opponentStateLabel = useAppSelector((state) => selectOpponentStateLabel(state, matchId))
  const remoteId = useAppSelector((state) => selectRemoteOpponentId(state, matchId))
  const levelConfigs = useAppSelector((state) => isSpectator ? selectLevelConfigs(state) : EMPTY_CONFIGS)
  const levelStatusTiers = useAppSelector((state) => isSpectator ? selectLevelStatusTiers(state) : EMPTY_STATUS_TIERS)

  const normalBot = !isSpectator && isBot
  const {data: remoteProfile} = useGetProfileQuery(isSpectator || normalBot ? skipToken : (remoteId ?? skipToken))
  const {data: ownerProfile} = useGetProfileQuery(isSpectator ? (ownerId ?? skipToken) : skipToken)
  const {data: opponentProfile} = useGetProfileQuery(isSpectator ? (opponentId ?? skipToken) : skipToken)

  const spectatorColor = useAppSelector((state) => isSpectator ? selectSpectatorColor(state, matchId, seat) : null)
  const color: Player | null = isSpectator ? spectatorColor : null
  const score = useAppSelector((state) => isSpectator ? selectSpectatorScore(state, matchId, seat) : 0)
  const isTurn = isSpectator
    ? !matchFinished && !betweenGames && color !== null && effectiveTurn === color
    : seat === "self" ? pairedSelfTurn : pairedOpponentTurn

  const identity = isSpectator
    ? (isBot && seat === "self"
      ? aiIdentityFromSeed(matchId)
      : profileToIdentity(seat === "opponent" ? ownerProfile ?? null : opponentProfile ?? null))
    : seat === "self" ? null : isBot ? aiIdentityFromSeed(matchId) : profileToIdentity(remoteProfile ?? null)
  const progression = isSpectator
    ? getProfileProgression(seat === "opponent" ? ownerProfile ?? null : opponentProfile ?? null, levelConfigs, levelStatusTiers)
    : null
  const level = isSpectator
    ? isBot && seat === "self" ? opponentLevel : progression?.level ?? 23
    : opponentLevel
  const stateLabel = isSpectator
    ? isBot && seat === "self" ? opponentStateLabel : progression?.statusLabel ?? "Guest"
    : opponentStateLabel
  const bottomSlot = seat === "self" && !isSpectator && controlsVisible
    ? (
      <MatchSecondaryControls
        autoRollSlot={onAutoRollChange ? <AutoRollToggle
          enabled={autoRollEnabled}
          variant="inline"
          onChange={onAutoRollChange}/> : undefined}
        canDouble={canDouble}
        cubeValue={cubeValue}
        showCube={target > 1}
        onDouble={onDouble ?? NOOP}/>
    )
    : undefined

  const identityNode = seat === "self" && !isSpectator
    ? <SelfIdentityBlock compact={compact}/>
    : (<PlayerIdentityBlock
      avatarSize={compact ? 58 : 106}
      coinsLabel="—"
      compact={compact}
      identity={identity}
      innerAvatarSize={Math.round((compact ? 58 : 106) * 0.66)}
      level={level}
      side={seat === "opponent" ? "left" : "right"}
      stateLabel={stateLabel}/>)
  const stats = isSpectator ? (<>
    <SpectatorPipCountStat
      compact={compact}
      matchId={matchId}
      seat={seat}/>
    <PlayerStatRow
      compact={compact}
      icon="score"
      label="Score"
      side={seat === "opponent" ? "left" : "right"}
      value={`${score} / ${target}`}/>
    <PlayerStatRow
      compact={compact}
      icon="cube"
      label="Doubles"
      side={seat === "opponent" ? "left" : "right"}
      value={cubeValue > 1 ? String(cubeValue) : "0"}/>
  </>) : (<>
    <PipCountStat
      compact={compact}
      matchId={matchId}
      mode="online"
      seat={seat}/>
    <ScoreStat
      compact={compact}
      matchId={matchId}
      mode="online"
      seat={seat}/>
    <DoublesStat
      compact={compact}
      matchId={matchId}
      mode="online"
      seat={seat}/>
  </>)

  return (<PlayerPanelShell
    align={seat === "opponent" ? "items-start" : "items-end"}
    bottomSlot={bottomSlot}
    compact={compact}
    identity={identityNode}
    isTurn={isTurn}
    side={seat === "opponent" ? "left" : "right"}
    stats={stats}
    timer={isSpectator ? null : <SeatTurnTimer
      compact={compact}
      matchId={matchId}
      mode="online"
      seat={seat}/>}/>)
})
