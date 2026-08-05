import {useCallback, useEffect, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query"
import {Link, useNavigate, useParams, useSearchParams} from "react-router-dom"

import type {AILevel} from "../../../../packages/ai/src/types"
import {pipCount} from "../../../../packages/engine/src/board"
import type {MatchState} from "../../../../packages/engine/src/match"
import type {Database} from "../../../../packages/shared/src/database"
import {getProfileProgression} from "../../../../packages/shared/src/progression"
import {ActionButtons, MatchSecondaryControls} from "../components/ActionButtons"
import {AutoRollToggle} from "../components/AutoRollToggle"
import {BoardLayout} from "../components/BoardLayout"
import {CubeOfferDecision} from "../components/CubeOfferDecision"
import {DICE_ANIMATION_MS} from "../components/diceTiming"
import {MatchHeader} from "../components/MatchHeader"
import {useNavigationLoaderOverlay} from "../features/appUi/useNavigationLoaderOverlay"
import {selectAuthUserId, selectCurrentProfile, selectCurrentWallet, selectLevelConfigs, selectLevelStatusTiers, selectProfileProgression, selectAuthInitializing} from "../features/auth/authSelectors"
import {useBoardThemeConfig} from "../features/lobby/boardTheme"
import {OnlineBoardSurface} from "../features/onlineMatch/OnlineBoardSurface"
import {onlineAutoRollEligibilityChanged} from "../features/onlineMatch/onlineMatchActions"
import {
  FALLBACK_POLL_MS,
  finishTurnCacheKey,
  rollDiceCacheKey,
  useAcceptDoubleMutation,
  useCancelMatchMutation,
  useDropDoubleMutation,
  useFinalizeMatchMutation,
  useFinishTurnMutation,
  useGetActiveMatchQuery,
  useOfferDoubleMutation,
  useRollDiceMutation,
} from "../features/onlineMatch/onlineMatchApi"
import {buildFinalizeScores} from "../features/onlineMatch/onlineMatchData"
import {
  selectBetweenGames,
  selectBoard,
  selectCanClaimByInactivity,
  selectCanEndTurn,
  selectCanOfferDouble,
  selectCanRoll,
  selectCubeOffer,
  selectCubeOwner,
  selectCubeValue,
  selectCurrentGame,
  selectCurrentTurn,
  selectEffectiveTurn,
  selectFinishTurnPending,
  selectGameWinner,
  selectInCrawfordGame,
  selectIsLocalTurn,
  selectLocalColor,
  selectMatch,
  selectMatchFinished,
  selectOpponentPreviewKey,
  selectRoll,
  selectRollPending,
  selectTimerViewModel,
} from "../features/onlineMatch/onlineMatchSelectors"
import {
  onlineMatchRouteEntered,
  onlineMatchRouteExited,
  opponentPreviewRevealed,
} from "../features/onlineMatch/onlineMatchSlice"
import {useGetProfileQuery} from "../features/playerData/playerDataApi"
import {parseMatchEntryParams} from "../game/matchEntryPath"
import {generateAIPersona} from "../lib/aiPersona"
import {formatCompactNumber} from "../lib/format"
import {aiIdentityFromSeed, aiRankLabel, type PlayerIdentity} from "../lib/identity"
import {useAutoRoll} from "../lib/useAutoRoll"
import {toApiError} from "../store/baseApi"
import {useAppDispatch, useAppSelector} from "../store/hooks"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

function profileToIdentity(p: ProfileRow | null): PlayerIdentity | null {
  if (!p) return null
  return {
    name: p.display_name,
    avatarSeed: p.avatar_seed,
    avatarUrl: p.avatar_url,
  }
}

export function PlayOnline() {
  const {matchId} = useParams<{matchId: string}>()
  const [params] = useSearchParams()
  const userId = useAppSelector(selectAuthUserId)
  const user = userId ? {id: userId} : null
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)
  const levelConfigs = useAppSelector(selectLevelConfigs)
  const levelStatusTiers = useAppSelector(selectLevelStatusTiers)
  const authLoading = useAppSelector(selectAuthInitializing)
  const navigate = useNavigate()
  const dispatch = useAppDispatch()

  // The lobby shows the overlay before routing here; PlayOnline owns
  // the hide call once the first load resolves (match found or error).
  const {hide: hideOverlay} = useNavigationLoaderOverlay()

  // Entry params have one definition shared with the lobby's entry-path builder.
  const {turnSeconds: turnSecondsParam, inactivityForfeitMs, boardId: boardParam} = parseMatchEntryParams(params)
  const turnSecondsTotal = turnSecondsParam

  const activeMatch = useGetActiveMatchQuery(matchId ?? skipToken, {
    pollingInterval: FALLBACK_POLL_MS,
  })
  const loading = activeMatch.isUninitialized || activeMatch.isLoading
  const [actionError, setActionError] = useState<string | null>(null)
  const reportActionError = useCallback((message: string) => {
    setActionError(message)
  }, [])

  useEffect(() => {
    setActionError(null)
  }, [activeMatch.fulfilledTimeStamp])

  const fetchError = activeMatch.error ? activeMatch.error.message ?? "failed to load match" : null
  const error = actionError ?? fetchError

  useEffect(() => {
    dispatch(onlineMatchRouteEntered({
      matchId: matchId ?? null,
      sessionStartedMs: Date.now(),
      turnSeconds: turnSecondsTotal,
      inactivityForfeitMs: inactivityForfeitMs ?? 5 * 60 * 1000,
    }))
    return () => {
      dispatch(onlineMatchRouteExited())
    }
  }, [dispatch, matchId, turnSecondsTotal, inactivityForfeitMs])

  const [triggerRollDice] = useRollDiceMutation({fixedCacheKey: rollDiceCacheKey(matchId ?? "")})
  const [triggerFinishTurn] = useFinishTurnMutation({fixedCacheKey: finishTurnCacheKey(matchId ?? "")})
  const [triggerOfferDouble] = useOfferDoubleMutation()
  const [triggerAcceptDouble] = useAcceptDoubleMutation()
  const [triggerDropDouble] = useDropDoubleMutation()
  const [triggerCancelMatch] = useCancelMatchMutation()
  const [triggerFinalizeMatch] = useFinalizeMatchMutation()

  const rollPending = useAppSelector((state) => selectRollPending(state, matchId))
  const finishTurnPending = useAppSelector((state) => selectFinishTurnPending(state, matchId))
  const match = useAppSelector((state) => selectMatch(state, matchId))
  const currentGame = useAppSelector((state) => selectCurrentGame(state, matchId))
  const currentTurn = useAppSelector((state) => selectCurrentTurn(state, matchId))
  const board = useAppSelector((state) => selectBoard(state, matchId))
  const effectiveTurn = useAppSelector((state) => selectEffectiveTurn(state, matchId))
  const localColor = useAppSelector((state) => selectLocalColor(state, matchId))
  const isLocalTurn = useAppSelector((state) => selectIsLocalTurn(state, matchId))
  const roll = useAppSelector((state) => selectRoll(state, matchId))
  const canRoll = useAppSelector((state) => selectCanRoll(state, matchId))
  const canEndTurn = useAppSelector((state) => selectCanEndTurn(state, matchId))
  const gameWinner = useAppSelector((state) => selectGameWinner(state, matchId))
  const matchFinished = useAppSelector((state) => selectMatchFinished(state, matchId))
  const cubeValue = useAppSelector((state) => selectCubeValue(state, matchId))
  const cubeOwner = useAppSelector((state) => selectCubeOwner(state, matchId))
  const cubeOffer = useAppSelector((state) => selectCubeOffer(state, matchId))
  const canOfferDouble = useAppSelector((state) => selectCanOfferDouble(state, matchId))
  const betweenGames = useAppSelector((state) => selectBetweenGames(state, matchId))
  const inCrawfordGame = useAppSelector((state) => selectInCrawfordGame(state, matchId))
  const opponentPreviewKey = useAppSelector((state) => selectOpponentPreviewKey(state, matchId))
  const canClaimByInactivity = useAppSelector((state) => selectCanClaimByInactivity(state, matchId))
  const timer = useAppSelector((state) => selectTimerViewModel(state, matchId))

  const rollDice = useCallback(async () => {
    if (!matchId || !canRoll || rollPending) return
    setActionError(null)
    try {
      await triggerRollDice(matchId).unwrap()
    }
    catch (err) {
      setActionError(toApiError(err).message)
    }
  }, [matchId, canRoll, rollPending, triggerRollDice])

  const endTurn = useCallback(async () => {
    if (!matchId || !match || !currentTurn || !match.current_game_id) return
    if (!isLocalTurn || finishTurnPending) return
    try {
      await triggerFinishTurn(matchId).unwrap()
    }
    catch (err) {
      setActionError(toApiError(err).message)
    }
  }, [matchId, match, currentTurn, isLocalTurn, finishTurnPending, triggerFinishTurn])

  const offerDouble = useCallback(async () => {
    if (!matchId || !canOfferDouble || !localColor) return
    setActionError(null)
    try {
      await triggerOfferDouble({matchId, offeredBy: localColor}).unwrap()
    }
    catch (err) {
      setActionError(toApiError(err).message)
    }
  }, [matchId, canOfferDouble, localColor, triggerOfferDouble])

  const acceptDouble = useCallback(async () => {
    if (!matchId || !match || cubeOffer === null) return
    if (localColor === null || cubeOffer === localColor) return
    setActionError(null)
    const newValue = Math.min(cubeValue * 2, 64)
    try {
      await triggerAcceptDouble({matchId, cubeValue: newValue, cubeOwner: localColor}).unwrap()
    }
    catch (err) {
      setActionError(toApiError(err).message)
    }
  }, [matchId, match, cubeOffer, localColor, cubeValue, triggerAcceptDouble])

  const dropDouble = useCallback(async () => {
    if (!matchId || !match || cubeOffer === null) return
    if (localColor === null || cubeOffer === localColor) return
    if (!match.current_game_id) return
    setActionError(null)
    try {
      await triggerDropDouble({
        matchId,
        gameId: match.current_game_id,
        winner: cubeOffer,
        cubeValue,
        cubeOwner,
        whiteScore: match.white_score,
        blackScore: match.black_score,
        target: match.target,
        crawfordGameNumber: match.crawford_game_number,
        currentGameNumber: currentGame?.game_number ?? 0,
      }).unwrap()
    }
    catch (err) {
      setActionError(toApiError(err).message)
    }
  }, [matchId, match, cubeOffer, localColor, cubeValue, cubeOwner, currentGame, triggerDropDouble])

  const finalizeMatch = useCallback(async (args: {
    winner: "white" | "black",
    ownerAbandoned?: boolean,
    opponentAbandoned?: boolean,
  }): Promise<{ok: true} | {ok: false, alreadyFinished: boolean, message: string}> => {
    if (!matchId || !match) return {ok: false, alreadyFinished: false, message: "no match"}
    const {whiteScore, blackScore} = buildFinalizeScores(match, args.winner)
    try {
      await triggerFinalizeMatch({
        matchId,
        whiteScore,
        blackScore,
        winner: args.winner,
        crawfordGameNumber: match.crawford_game_number ?? null,
        ownerAbandoned: args.ownerAbandoned ?? false,
        opponentAbandoned: args.opponentAbandoned ?? false,
        userId,
      }).unwrap()
    }
    catch (err) {
      const msg = toApiError(err).message
      const alreadyFinished = msg.includes("match_already_finished")
      if (!alreadyFinished) setActionError(msg)
      return {ok: false, alreadyFinished, message: msg}
    }
    return {ok: true}
  }, [matchId, match, triggerFinalizeMatch, userId])

  const claimByInactivity = useCallback(async () => {
    if (!matchId || !match || !localColor || !canClaimByInactivity) return
    setActionError(null)
    const opponentIsOwner = userId === match.opponent_id
    await finalizeMatch({
      winner: localColor,
      ownerAbandoned: opponentIsOwner,
      opponentAbandoned: !opponentIsOwner,
    })
  }, [matchId, match, localColor, canClaimByInactivity, finalizeMatch, userId])

  useEffect(() => {
    if (!opponentPreviewKey) return
    const timer = window.setTimeout(
      () => dispatch(opponentPreviewRevealed({key: opponentPreviewKey})),
      DICE_ANIMATION_MS,
    )
    return () => {
      window.clearTimeout(timer)
    }
  }, [opponentPreviewKey, dispatch])

  const {theme: selectedTheme} = useBoardThemeConfig(boardParam)

  // The local player's profile is already cached via RTK Query; only
  // the remote seat needs a cache entry, keyed by player id.
  const remoteId = match ? (user?.id === match.owner_id ? match.opponent_id : match.owner_id) : null
  const {data: remoteProfile} = useGetProfileQuery(remoteId ?? "", {skip: !remoteId})

  // Auto-roll preference: the delay + eligibility re-check live in listeners.
  const [autoRollOn, setAutoRollOn] = useAutoRoll()
  useEffect(() => {
    dispatch(onlineAutoRollEligibilityChanged({enabled: autoRollOn}))
  }, [dispatch, autoRollOn])

  // Hide the route-spanning loader once the first load resolves.
  const overlayReady = !authLoading && (!loading || error !== null)
  useEffect(() => {
    if (overlayReady) hideOverlay()
  }, [overlayReady, hideOverlay])

  // Intro banner state.
  const [introVisible, setIntroVisible] = useState(true)
  const matchOpponentId = match?.opponent_id ?? null
  const hasCurrentGame = !!currentGame
  useEffect(() => {
    if (!matchOpponentId || hasCurrentGame) {
      setIntroVisible(false)
      return
    }
    setIntroVisible(true)
    const id = window.setTimeout(() => {
      setIntroVisible(false)
    }, 3500)
    return () => {
      window.clearTimeout(id)
    }
  }, [matchOpponentId, hasCurrentGame])

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-board-felt/60">
        Loading…
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-rose-400 gap-3 p-6">
        <div>Error: {error}</div>
        <Link
          className="text-board-accent text-sm"
          to="/play">← Home</Link>
      </main>
    )
  }

  if (!match || !user) return null

  const isOwner = user.id === match.owner_id
  const role: "owner" | "opponent" | "spectator" = isOwner ? "owner" : user.id === match.opponent_id ? "opponent" : "spectator"
  const waiting = match.opponent_id === null && !match.is_bot

  if (waiting) {
    return (
      <main className="min-h-screen flex flex-col items-center bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
        <header className="w-full flex items-center justify-between px-4 py-3 text-board-felt/80">
          <Link
            className="text-board-accent text-sm"
            to="/play">← Home</Link>
          <div className="text-xs text-board-felt/50">Online{match.target > 1 ? ` · to ${match.target}` : ""}</div>
          <Link
            className="text-xs text-board-felt/60 hover:text-board-accent"
            to="/profile">Profile</Link>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md w-full p-6">
          <div className="font-display text-3xl text-board-accent text-center">
            Waiting for opponent…
          </div>
          {isOwner && (
            <button
              className="text-xs text-board-felt/50 hover:text-rose-400 transition"
              onClick={async () => {
                if (!confirm("Cancel this online match?")) return
                await triggerCancelMatch(match.id)
                navigate("/play")
              }}>
              Cancel match
            </button>
          )}
        </div>
      </main>
    )
  }

  const whitePip = pipCount(board, "white")
  const blackPip = pipCount(board, "black")
  const isSpectator = role === "spectator"

  // Bot identity: deterministic from matchId so it doesn't reshuffle.
  const isBotMatch = match.is_bot
  const botLvl: AILevel = match.bot_level === "easy" || match.bot_level === "hard" ? match.bot_level : "medium"
  const botPersona = isBotMatch ? generateAIPersona(matchId ?? null, botLvl) : null
  const botIdentity = isBotMatch ? aiIdentityFromSeed(matchId ?? "") : null

  // Map owner/opponent profiles to seats based on local color.
  const ownerColor = match.owner_color === "black" ? "black" : "white"
  const opponentColor = ownerColor === "white" ? "black" : "white"
  const isOwnerLocal = user.id === match.owner_id
  const selfProfile = profile
  const opponentProf = remoteProfile ?? null
  const selfColor = isOwnerLocal ? ownerColor : opponentColor
  const oppColor = selfColor === "white" ? "black" : "white"
  const selfPip = selfColor === "white" ? whitePip : blackPip
  const oppPip = oppColor === "white" ? whitePip : blackPip
  const isRollForSelf = effectiveTurn === selfColor
  const selfProgression = progression
  const opponentProgression = getProfileProgression(opponentProf, levelConfigs, levelStatusTiers)
  const selfName = selfProfile?.display_name
  const oppName = isBotMatch ? botIdentity!.name : opponentProf?.display_name

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

  const showCubeDecisionCenter = cubeOffer !== null && localColor !== null && cubeOffer !== localColor && !matchFinished
  const showCubePending = cubeOffer !== null && cubeOffer === localColor && !matchFinished
  const showBetweenGames = betweenGames && !matchFinished && !!currentGame
  const showMatchOver = matchFinished && !!match.winner

  const firstRollerColor: "white" | "black" = "white"
  const firstRollerName = firstRollerColor === selfColor ? selfName ?? "You" : oppName ?? "Opponent"
  const firstRollerIsLocal = firstRollerColor === selfColor
  const showIntroBanner = introVisible && !!match.opponent_id && !currentGame && !matchFinished

  const showActions = role !== "spectator" && !betweenGames && !matchFinished && cubeOffer === null
  const gameplayBackground = selectedTheme.gameplayBackgroundImage ?? selectedTheme.backgroundImage

  return (
    <BoardLayout
      actionsOverlay={showActions ? (
        <ActionButtons
          canEndTurn={canEndTurn}
          canRoll={canRoll}
          canUndo={false}
          onEndTurn={() => void endTurn()}
          onRoll={() => void rollDice()}
          onUndo={() => {
            throw new Error("Undo is not supported in this version of the game")
          }}/>
      ) : null}
      backgroundImage={gameplayBackground}
      centerOverlay={showIntroBanner ? (
        <button
          className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm hover:brightness-105 active:scale-95 transition cursor-pointer"
          type="button"
          onClick={() => {
            setIntroVisible(false)
          }}>
          <div className="font-display text-2xl uppercase tracking-wider mb-1">
            {firstRollerIsLocal ? "You roll first" : `${firstRollerName} rolls first`}
          </div>
          <div className="text-sm">
            {firstRollerIsLocal
              ? `${selfName ?? "You"} (${firstRollerColor}) start the match.`
              : `${firstRollerName} (${firstRollerColor}) starts the match.`}
          </div>
          <div className="text-[11px] text-amber-900/60 mt-2">Tap to dismiss</div>
        </button>
      ) : showCubeDecisionCenter ? (
        <CubeOfferDecision
          currentValue={cubeValue}
          offeredBy={cubeOffer}
          onAccept={() => void acceptDouble()}
          onDrop={() => void dropDouble()}/>
      ) : showCubePending ? (
        <div className="bg-amber-100/95 text-amber-950 px-6 py-4 rounded-xl border-2 border-amber-700 text-sm">
          Waiting for opponent to accept or drop…
        </div>
      ) : showBetweenGames ? (
        <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm">
          <div className="font-display text-2xl uppercase tracking-wider mb-1 capitalize">
            {currentGame.winner} wins
            {currentGame.dropped_double
              ? " by drop"
              : currentGame.win_type
                ? ` ${currentGame.win_type}`
                : ""}
          </div>
          <div className="text-sm mb-3">
            +{currentGame.points_awarded} · match {match.white_score}–{match.black_score} (to {match.target})
          </div>
          <div className="text-xs text-amber-900/70">
            {localColor === effectiveTurn
              ? "Roll to start the next game."
              : `Waiting for ${effectiveTurn} to roll the next game…`}
          </div>
          {localColor === effectiveTurn && (
            <button
              className="mt-4 px-5 py-2 rounded-md bg-amber-700 text-amber-50 font-medium hover:brightness-110 active:scale-95 transition"
              onClick={() => void rollDice()}>
              Roll · next game
            </button>
          )}
        </div>
      ) : showMatchOver ? (
        (() => {
          const ct = match.current_turn as {_abandonment?: {abandoner_id?: string}} | null
          const abandoner = ct?._abandonment?.abandoner_id ?? null
          const localWon = match.winner === localColor
          const showForfeit = abandoner !== null && localWon
          return (
            <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center">
              <div className="font-display text-3xl uppercase tracking-wider mb-1">
                {showForfeit ? "Opponent forfeited" : "Match over"}
              </div>
              <div className="capitalize text-xl mb-3 font-display">
                {showForfeit
                  ? `You win ${match.white_score}–${match.black_score}`
                  : `${match.winner ?? "Unknown player"} wins ${match.white_score}–${match.black_score}`}
              </div>
              {showForfeit && (
                <div className="text-xs text-amber-900/70 mb-3">
                  Your opponent disconnected. The win + payout have been credited to you.
                </div>
              )}
              <button
                className="px-6 py-2 rounded-md bg-amber-700 text-amber-50 font-medium hover:brightness-110 active:scale-95 transition"
                onClick={() => navigate("/play")}>
                Home
              </button>
            </div>
          )
        })()
      ) : null}
      header={<MatchHeader
        blackName={selfName ?? "Player"}
        blackPip={selfPip}
        inCrawford={inCrawfordGame}
        match={headerMatch}
        turnLabel={turnLabel}
        whiteName={oppName ?? "Opponent"}
        whitePip={oppPip}/>}
      opponent={{
        identity: isBotMatch ? botIdentity : profileToIdentity(opponentProf),
        pipCount: oppPip,
        scoreLabel: `${oppColor === "white" ? match.white_score : match.black_score} / ${match.target}`,
        level: isBotMatch ? botPersona!.level : opponentProgression.level,
        stateLabel: isBotMatch ? aiRankLabel(botLvl) : opponentProgression.statusLabel,
        coinsLabel: "—",
        isTurn: !isLocalTurn && !showMatchOver,
        timerDeadlineMs: !isLocalTurn && !showMatchOver && !betweenGames ? (timer.deadlineMs ?? undefined) : undefined,
        timerDurationMs: !isLocalTurn && !showMatchOver && !betweenGames ? (timer.durationMs ?? undefined) : undefined,
      }}
      self={{
        identity: profileToIdentity(selfProfile),
        pipCount: selfPip,
        scoreLabel: `${selfColor === "white" ? match.white_score : match.black_score} / ${match.target}`,
        level: selfProgression.level,
        stateLabel: selfProgression.statusLabel,
        coinsLabel: formatCompactNumber(wallet?.coins),
        isTurn: isLocalTurn && !showMatchOver,
        timerDeadlineMs: isLocalTurn && !showMatchOver && !betweenGames ? (timer.deadlineMs ?? undefined) : undefined,
        timerDurationMs: isLocalTurn && !showMatchOver && !betweenGames ? (timer.durationMs ?? undefined) : undefined,
        bottomSlot: showActions ? (
          <MatchSecondaryControls
            autoRollSlot={!isSpectator ? (
              <AutoRollToggle
                enabled={autoRollOn}
                variant="inline"
                onChange={setAutoRollOn} />
            ) : null}
            canDouble={canOfferDouble}
            cubeValue={cubeValue}
            showCube={match.target > 1}
            onDouble={() => void offerDouble()}/>
        ) : undefined,
      }}>
      <OnlineBoardSurface
        isSpectator={isSpectator}
        matchId={match.id}
        selectedTheme={selectedTheme}
        settleSide={isRollForSelf ? "right" : "left"}
        onActionError={reportActionError}/>

      {!isSpectator && !matchFinished && canClaimByInactivity && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 border border-board-felt/20 text-board-felt/80 text-xs px-3 py-1.5 rounded z-20 flex items-center gap-2 backdrop-blur">
          <span>Opponent disconnected</span>
          <button
            className="px-2 py-0.5 rounded bg-amber-700 text-amber-50 hover:brightness-110"
            onClick={async () => {
              await claimByInactivity()
            }}>
            Claim victory
          </button>
        </div>
      )}
    </BoardLayout>
  )
}
