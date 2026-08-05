import {memo} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import type {MatchState} from "../../../../../packages/engine/src/match"
import {MatchHeader} from "../../components/MatchHeader"
import {aiIdentityFromSeed} from "../../lib/identity"
import {useAppSelector} from "../../store/hooks"
import {selectAuthUserId, selectCurrentProfile} from "../auth/authSelectors"
import {useGetProfileQuery} from "../playerData/playerDataApi"

import {
  selectBlackPipCount,
  selectCubeOffer,
  selectCubeOwner,
  selectCubeValue,
  selectEffectiveTurn,
  selectGameWinner,
  selectInCrawfordGame,
  selectIsLocalTurn,
  selectMatch,
  selectMatchFinished,
  selectRoll,
  selectWhitePipCount,
} from "./onlineMatchSelectors"

type Props = {
  readonly matchId: string,
}

export const OnlineMatchHeader = memo(function OnlineMatchHeader({matchId}: Props) {
  const userId = useAppSelector(selectAuthUserId)
  const profile = useAppSelector(selectCurrentProfile)
  const match = useAppSelector((state) => selectMatch(state, matchId))
  const whitePip = useAppSelector((state) => selectWhitePipCount(state, matchId))
  const blackPip = useAppSelector((state) => selectBlackPipCount(state, matchId))
  const effectiveTurn = useAppSelector((state) => selectEffectiveTurn(state, matchId))
  const isLocalTurn = useAppSelector((state) => selectIsLocalTurn(state, matchId))
  const roll = useAppSelector((state) => selectRoll(state, matchId))
  const gameWinner = useAppSelector((state) => selectGameWinner(state, matchId))
  const matchFinished = useAppSelector((state) => selectMatchFinished(state, matchId))
  const cubeValue = useAppSelector((state) => selectCubeValue(state, matchId))
  const cubeOwner = useAppSelector((state) => selectCubeOwner(state, matchId))
  const cubeOffer = useAppSelector((state) => selectCubeOffer(state, matchId))
  const inCrawfordGame = useAppSelector((state) => selectInCrawfordGame(state, matchId))

  const isOwner = match !== null && userId === match.owner_id
  const isSpectator = match !== null && !isOwner && userId !== match.opponent_id
  const remoteId = match ? (isOwner ? match.opponent_id : match.owner_id) : null
  const ownerId = match?.owner_id ?? null
  const opponentId = match?.opponent_id ?? null
  const {data: remoteProfile} = useGetProfileQuery(!isSpectator ? (remoteId ?? skipToken) : skipToken)
  const {data: ownerProfile} = useGetProfileQuery(isSpectator ? (ownerId ?? skipToken) : skipToken)
  const {data: opponentProfile} = useGetProfileQuery(isSpectator && !match?.is_bot ? (opponentId ?? skipToken) : skipToken)

  if (!match || !userId) return null

  const ownerColor = match.owner_color === "black" ? "black" : "white"
  const botIdentity = match.is_bot ? aiIdentityFromSeed(matchId) : null
  const ownerName = isSpectator
    ? ownerProfile?.display_name
    : isOwner ? profile?.display_name : remoteProfile?.display_name
  const opponentName = match.is_bot
    ? botIdentity?.name
    : isSpectator ? opponentProfile?.display_name : isOwner ? remoteProfile?.display_name : profile?.display_name
  const ownerPip = ownerColor === "white" ? whitePip : blackPip
  const opponentPip = ownerColor === "white" ? blackPip : whitePip
  const whiteName = ownerColor === "white" ? ownerName : opponentName
  const blackName = ownerColor === "black" ? ownerName : opponentName
  const whitePlayerPip = ownerColor === "white" ? ownerPip : opponentPip
  const blackPlayerPip = ownerColor === "black" ? ownerPip : opponentPip

  const turnLabel = matchFinished
    ? "match over"
    : isSpectator
      ? `${effectiveTurn} to ${roll === null ? "roll" : "move"}`
      : gameWinner
        ? `${gameWinner} wins game`
        : !isLocalTurn
          ? `${effectiveTurn}'s turn`
          : roll === null
            ? "your turn — roll"
            : "your turn — move"

  const headerMatch: MatchState = {
    score: {white: match.white_score, black: match.black_score},
    target: match.target,
    cube: {value: cubeValue, owner: cubeOwner},
    cubeOffer,
    crawfordGameNumber: null,
    gameNumber: 1,
    winner: null,
  }

  return (
    <MatchHeader
      blackName={blackName ?? "Player"}
      blackPip={blackPlayerPip}
      inCrawford={inCrawfordGame}
      match={headerMatch}
      turnLabel={turnLabel}
      whiteName={whiteName ?? "Opponent"}
      whitePip={whitePlayerPip}/>
  )
})
