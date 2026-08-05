import {memo} from "react"

import {MatchHeader} from "../../components/MatchHeader"
import {getSessionGuestIdentity} from "../../lib/identity"
import {useAppSelector} from "../../store/hooks"
import {selectCurrentProfile} from "../auth/authSelectors"

import {
  selectBoardTurn,
  selectInCrawfordGame,
  selectIsAIThinking,
  selectIsAITurn,
  selectLastGameResult,
  selectLocalColor,
  selectMatch,
  selectMatchOver,
  selectOpponentColor,
  selectOpponentPipCount,
  selectOpponentIdentity,
  selectPendingOffer,
  selectRoll,
  selectSelfPipCount,
} from "./gameplaySelectors"

export const HotSeatMatchHeader = memo(function HotSeatMatchHeader() {
  const match = useAppSelector(selectMatch)
  const boardTurn = useAppSelector(selectBoardTurn)
  const roll = useAppSelector(selectRoll)
  const pendingOffer = useAppSelector(selectPendingOffer)
  const lastGameResult = useAppSelector(selectLastGameResult)
  const matchOver = useAppSelector(selectMatchOver)
  const isAIThinking = useAppSelector(selectIsAIThinking)
  const isAITurn = useAppSelector(selectIsAITurn)
  const inCrawford = useAppSelector(selectInCrawfordGame)
  const localColor = useAppSelector(selectLocalColor)
  const opponentColor = useAppSelector(selectOpponentColor)
  const selfPip = useAppSelector(selectSelfPipCount)
  const opponentPip = useAppSelector(selectOpponentPipCount)
  const opponentIdentity = useAppSelector(selectOpponentIdentity)
  const profile = useAppSelector(selectCurrentProfile)
  const selfIdentity = profile ? {
    name: profile.display_name,
    avatarSeed: profile.avatar_seed,
    avatarUrl: profile.avatar_url,
  } : getSessionGuestIdentity()
  const turnLabel = matchOver
    ? "match over"
    : lastGameResult
      ? "game over"
      : pendingOffer
        ? `${pendingOffer === "white" ? "black" : "white"} decides`
        : isAIThinking
          ? `${boardTurn} (AI) thinking…`
          : isAITurn
            ? `${boardTurn} (AI)`
            : roll === null
              ? `${boardTurn} to roll`
              : `${boardTurn} to move`

  return (
    <MatchHeader
      blackName={opponentColor === "black" ? opponentIdentity.name : selfIdentity.name}
      blackPip={opponentColor === "black" ? opponentPip : selfPip}
      inCrawford={inCrawford}
      match={match}
      turnLabel={turnLabel}
      whiteName={localColor === "white" ? selfIdentity.name : opponentIdentity.name}
      whitePip={localColor === "white" ? selfPip : opponentPip}/>
  )
})
