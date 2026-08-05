import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useState} from "react"

import {useNavigate, useSearchParams} from "react-router-dom"

import {AI_LEVELS, type AILevel} from "../../../../packages/ai/src/types"
import type {AlignmentDebugSelection} from "../../../../packages/board-renderer/src/pixi/BoardRenderer"
import {premiumTheme} from "../../../../packages/board-renderer/src/theme/premium"
import type {ThemeLayout} from "../../../../packages/board-renderer/src/theme/types"
import {pipCount} from "../../../../packages/engine/src/board"
import {ActionButtons, MatchSecondaryControls} from "../components/ActionButtons"
import {AlignmentPanel} from "../components/AlignmentPanel"
import {AutoRollToggle} from "../components/AutoRollToggle"
import {BoardLayout} from "../components/BoardLayout"
import {CubeOfferDecision} from "../components/CubeOfferDecision"
import {EndOfGameModal} from "../components/EndOfGameModal"
import {MatchHeader} from "../components/MatchHeader"
import {useNavigationLoaderOverlay} from "../features/appUi/useNavigationLoaderOverlay"
import {selectCurrentProfile, selectCurrentWallet, selectProfileProgression} from "../features/auth/authSelectors"
import {autoRollEligibilityChanged} from "../features/gameplay/gameplayActions"
import {gameplayFinishCacheKey, useFinishMatchRpcMutation} from "../features/gameplay/gameplayApi"
import {
  selectBoard,
  selectCanEndTurn,
  selectCanOfferDouble,
  selectCanRoll,
  selectCanUndo,
  selectHumanCanInteract,
  selectInCrawfordGame,
  selectIsAIThinking,
  selectIsAITurn,
  selectLastGameResult,
  selectMatch,
  selectMatchId,
  selectMatchOver,
  selectOpeningPlayer,
  selectPendingOffer,
  selectRoll,
  selectTimerViewModel,
} from "../features/gameplay/gameplaySelectors"
import {
  type AIConfig,
  DEFAULT_TURN_SECONDS,
  diceRolled,
  doubleAccepted,
  doubleDropped,
  doubleOffered,
  gameContinued,
  gameplayRouteEntered,
  gameplayRouteExited,
  lastMoveUndone,
  turnEnded,
} from "../features/gameplay/gameplaySlice"
import {HotSeatBoardSurface} from "../features/gameplay/HotSeatBoardSurface"
import {useBoardThemeConfig} from "../features/lobby/boardTheme"
import {generateAIPersona} from "../lib/aiPersona"
import {formatCompactNumber} from "../lib/format"
import {aiRankLabel, makeAIIdentity, makeGuestIdentity, type PlayerIdentity} from "../lib/identity"
import {useAutoRoll} from "../lib/useAutoRoll"
import {useImagePreloader} from "../lib/useImagePreloader"
import {useAppDispatch, useAppSelector} from "../store/hooks"

// Static gameplay chrome — header art, action-button icons, etc. — that
// every match shares regardless of board theme. Pre-fetched so the
// game-screen renders fully composed.
const GAMEPLAY_STATIC_ASSETS: readonly string[] = ["/gameplay/premium-purple/auto.webp", "/gameplay/premium-purple/cube.webp", "/gameplay/premium-purple/double.webp", "/gameplay/premium-purple/end-turn-square.webp", "/gameplay/premium-purple/header.webp", "/gameplay/premium-purple/left-player.webp", "/gameplay/premium-purple/left-timer.webp", "/gameplay/premium-purple/player-stats.webp", "/gameplay/premium-purple/right-player.webp", "/gameplay/premium-purple/right-timer.webp", "/gameplay/premium-purple/roll.webp", "/gameplay/premium-purple/settings.webp", "/gameplay/premium-purple/stats.webp", "/gameplay/premium-purple/undo-square.webp", "/gameplay/premium-purple/undo.webp"]

function parseOpponent(raw: string | null): AIConfig | null {
  if (!raw || raw === "hotseat") return null
  if ((AI_LEVELS as readonly string[]).includes(raw)) {
    return {
      player: "black",
      level: raw as AILevel,
    }
  }
  return null
}

function parseTarget(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN
  // Default 1: quick-match (single game). N-point matches still work
  // when explicitly requested via ?target=N, kept for future tournaments.
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

const ALIGNMENT_STORAGE_KEY = "gammon-rivals:premium-alignment-layout"

/** Clamp the URL-sourced turn timer to the same range the server enforces
 *  on table_configs.turn_seconds, so a forged `?turn=` query param can't
 *  trigger a 1-second timeout in the client. */
function parseTurnSeconds(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return DEFAULT_TURN_SECONDS
  return Math.min(600, Math.max(5, n))
}

function copyRatios(value: readonly number[] | undefined): number[] | undefined {
  return value?.length === 12 ? [...value] : undefined
}

function basePremiumLayout(): ThemeLayout {
  // Alignment tool's reset target. Boards are managed via Back Office
  // and bring their own layouts; this fallback uses the generic
  // premium theme so the alignment tool has a baseline to nudge from.
  const layout = premiumTheme.layout ?? {}
  return {
    ...layout,
    topPointCenterXRatios: copyRatios(layout.topPointCenterXRatios),
    topPointTipXRatios: copyRatios(layout.topPointTipXRatios),
    bottomPointCenterXRatios: copyRatios(layout.bottomPointCenterXRatios),
    bottomPointTipXRatios: copyRatios(layout.bottomPointTipXRatios),
    topCheckerOffsetXRatios: copyRatios(layout.topCheckerOffsetXRatios),
    bottomCheckerOffsetXRatios: copyRatios(layout.bottomCheckerOffsetXRatios),
  }
}

function mergeAlignmentLayout(saved: ThemeLayout): ThemeLayout {
  const base = basePremiumLayout()
  return {
    ...base,
    topPointCenterXRatios: copyRatios(saved.topPointCenterXRatios) ?? base.topPointCenterXRatios,
    topPointTipXRatios: copyRatios(saved.topPointTipXRatios) ?? base.topPointTipXRatios,
    bottomPointCenterXRatios: copyRatios(saved.bottomPointCenterXRatios) ?? base.bottomPointCenterXRatios,
    bottomPointTipXRatios: copyRatios(saved.bottomPointTipXRatios) ?? base.bottomPointTipXRatios,
    topCheckerOffsetXRatios: copyRatios(saved.topCheckerOffsetXRatios) ?? base.topCheckerOffsetXRatios,
    bottomCheckerOffsetXRatios: copyRatios(saved.bottomCheckerOffsetXRatios) ?? base.bottomCheckerOffsetXRatios,
    pointHeightRatio: saved.pointHeightRatio ?? base.pointHeightRatio,
    topPointHeightRatio: saved.topPointHeightRatio ?? base.topPointHeightRatio,
    bottomPointHeightRatio: saved.bottomPointHeightRatio ?? base.bottomPointHeightRatio,
    topPointYRatio: saved.topPointYRatio ?? base.topPointYRatio,
    bottomPointYRatio: saved.bottomPointYRatio ?? base.bottomPointYRatio,
    checkerStackSpacingRatio: saved.checkerStackSpacingRatio ?? base.checkerStackSpacingRatio,
    topCheckerStackSpacingRatio: saved.topCheckerStackSpacingRatio ?? base.topCheckerStackSpacingRatio,
    bottomCheckerStackSpacingRatio: saved.bottomCheckerStackSpacingRatio ?? base.bottomCheckerStackSpacingRatio,
    topCheckerPaddingRatio: saved.topCheckerPaddingRatio ?? base.topCheckerPaddingRatio,
    bottomCheckerPaddingRatio: saved.bottomCheckerPaddingRatio ?? base.bottomCheckerPaddingRatio,
    blackOffTrayXRatio: saved.blackOffTrayXRatio ?? base.blackOffTrayXRatio,
    blackOffTrayTopRatio: saved.blackOffTrayTopRatio ?? base.blackOffTrayTopRatio,
    blackOffTrayHeightRatio: saved.blackOffTrayHeightRatio ?? base.blackOffTrayHeightRatio,
    whiteOffTrayXRatio: saved.whiteOffTrayXRatio ?? base.whiteOffTrayXRatio,
    whiteOffTrayTopRatio: saved.whiteOffTrayTopRatio ?? base.whiteOffTrayTopRatio,
    whiteOffTrayHeightRatio: saved.whiteOffTrayHeightRatio ?? base.whiteOffTrayHeightRatio,
    offCheckerStackSpacingRatio: saved.offCheckerStackSpacingRatio ?? base.offCheckerStackSpacingRatio,
    blackOffTrayTiltDeg: saved.blackOffTrayTiltDeg ?? base.blackOffTrayTiltDeg,
    whiteOffTrayTiltDeg: saved.whiteOffTrayTiltDeg ?? base.whiteOffTrayTiltDeg,
  }
}

function loadAlignmentLayout(): ThemeLayout {
  if (typeof window === "undefined") return basePremiumLayout()
  const raw = window.localStorage.getItem(ALIGNMENT_STORAGE_KEY)
  if (!raw) return basePremiumLayout()
  try {
    return mergeAlignmentLayout(JSON.parse(raw) as ThemeLayout)
  }
  catch {
    return basePremiumLayout()
  }
}

export function HotSeat() {
  const [params] = useSearchParams()
  const routeKey = params.toString()
  const navigate = useNavigate()
  const {
    show: showOverlay,
    hide: hideOverlay,
  } = useNavigationLoaderOverlay()
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)

  const opp = params.get("opp")
  const aiConfig = useMemo(() => parseOpponent(opp), [opp])
  const target = useMemo(() => parseTarget(params.get("target")), [params])
  // Board theme is a PER-CLIENT cosmetic — each player reads their
  // OWN selected theme from THEIR OWN URL's `?board=…` query param.
  // Matchmaking ignores theme entirely (see findMatchInTier in
  // src/features/lobby/matchmakingData.ts). Two players can be paired into the same
  // match with completely different themes on their screens.
  const boardParam = params.get("board")
  /**
   * When the difficulty modal calls enter_room(), the new match row is
   * created server-side before navigation. The modal then routes here
   * with ?matchId=<id>&turn=<seconds>. If those params are present we
   * reuse the existing match (the persistence workflow skips creation) and
   * pick up the per-room turn timer instead of the 45-second default.
   */
  const presetMatchId = params.get("matchId") ?? null
  const requestedTurnSeconds = useMemo(() => parseTurnSeconds(params.get("turn")), [params])
  const {
    theme: selectedTheme,
    isLoading: themeLoading,
  } = useBoardThemeConfig(boardParam)
  const alignmentEnabled = params.get("align") === "1"
  const [alignmentLayout, setAlignmentLayout] = useState<ThemeLayout>(() => loadAlignmentLayout())
  const [alignmentDebug, setAlignmentDebug] = useState<AlignmentDebugSelection>({
    enabled: true,
    side: "bottom",
    column: 0,
    anchor: "base",
  })

  useEffect(() => {
    if (!alignmentEnabled) return
    window.localStorage.setItem(ALIGNMENT_STORAGE_KEY, JSON.stringify(alignmentLayout))
  }, [alignmentEnabled, alignmentLayout])

  const dispatch = useAppDispatch()
  const gameplayComponentId = useId()
  const turnTimerEnabled = !alignmentEnabled
  const gameplaySessionId = `${gameplayComponentId}:${JSON.stringify([opp, target, presetMatchId, requestedTurnSeconds, turnTimerEnabled])}`
  // Route entry/exit: a fresh, clean session on every visit to /hotseat. The
  // target/ai/timer config comes through the payload; the random opening board
  // is added by the slice's `prepare` callback so the reducer never reads
  // randomness or clock. useLayoutEffect so the option-derived
  // match/board/AI state is committed before the first paint.
  useLayoutEffect(() => {
    dispatch(gameplayRouteEntered({
      sessionId: gameplaySessionId,
      presetMatchId,
      target,
      ai: aiConfig,
      turnSeconds: requestedTurnSeconds,
      turnTimerEnabled,
    }))
    return () => {
      dispatch(gameplayRouteExited())
    }
  }, [dispatch, gameplaySessionId, presetMatchId, target, aiConfig, requestedTurnSeconds, turnTimerEnabled])

  const handleRoll = useCallback(() => {
    dispatch(diceRolled())
  }, [dispatch])
  const handleEndTurn = useCallback(() => {
    dispatch(turnEnded())
  }, [dispatch])
  const handleUndo = useCallback(() => {
    dispatch(lastMoveUndone())
  }, [dispatch])
  const handleOfferDouble = useCallback(() => {
    dispatch(doubleOffered())
  }, [dispatch])
  const handleAcceptDouble = useCallback(() => {
    dispatch(doubleAccepted())
  }, [dispatch])
  const handleDropDouble = useCallback(() => {
    dispatch(doubleDropped())
  }, [dispatch])
  const handleNextGame = useCallback(() => {
    dispatch(gameContinued())
  }, [dispatch])
  // Rewards (XP + coins) granted by the server-side finish_match RPC.
  // Read from the mutation result in RTK Query so the end-of-game modal can
  // show "+50 XP / +200 coins"; the wallet/profile/XP refresh happens in the
  // gameplay listener so the lobby's top bar is correct when the user returns.
  const [, {data: matchReward}] = useFinishMatchRpcMutation({
    fixedCacheKey: gameplayFinishCacheKey(gameplaySessionId),
  })
  const matchId = useAppSelector(selectMatchId)
  const timer = useAppSelector(selectTimerViewModel)
  const match = useAppSelector(selectMatch)
  const board = useAppSelector(selectBoard)
  const roll = useAppSelector(selectRoll)
  const canEndTurn = useAppSelector(selectCanEndTurn)
  const canOfferDouble = useAppSelector(selectCanOfferDouble)
  const canUndo = useAppSelector(selectCanUndo)
  const pendingOffer = useAppSelector(selectPendingOffer)
  const lastGameResult = useAppSelector(selectLastGameResult)
  const matchOver = useAppSelector(selectMatchOver)
  const inCrawfordGame = useAppSelector(selectInCrawfordGame)
  const isAITurn = useAppSelector(selectIsAITurn)
  const isAIThinking = useAppSelector(selectIsAIThinking)
  const humanCanInteract = useAppSelector(selectHumanCanInteract)
  const playerCanRoll = useAppSelector(selectCanRoll)
  const alignmentPointIndex = alignmentDebug.side === "bottom" ? 12 + alignmentDebug.column : 11 - alignmentDebug.column
  const alignmentStackCount = board.points[alignmentPointIndex]?.count ?? 5
  const whitePip = pipCount(board, "white")
  const blackPip = pipCount(board, "black")

  // Self identity comes from the auth profile when available; otherwise a
  // local guest identity (random name + random avatar) until the profile
  // loads. Opponent is either an AI identity (for vs-AI mode) or another
  // local guest for true hot-seat 2-player.
  const selfIdentity: PlayerIdentity = useMemo(() => {
    if (profile) {
      return {
        name: profile.display_name,
        avatarSeed: profile.avatar_seed,
        avatarUrl: profile.avatar_url,
      }
    }
    return makeGuestIdentity()
  }, [profile])

  const opponentIdentity: PlayerIdentity = useMemo(() => (aiConfig ? makeAIIdentity() : makeGuestIdentity()), [aiConfig])

  // Match-start "rolls first" banner — parity with the PvP (PlayOnline) intro.
  // The opening player is now RANDOM (randomFirstBoard in gameplaySlice), so
  // the banner names whoever actually starts (you or the opponent).
  // Auto-dismisses after a few seconds, or tap to dismiss.
  const [introVisible, setIntroVisible] = useState(true)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setIntroVisible(false)
    }, 4000)
    return () => {
      window.clearTimeout(id)
    }
  }, [])

  // Statics + the selected theme's HTML backgrounds and Pixi textures.
  // Loading them via <img> warms the browser cache so BoardCanvas's
  // internal Pixi loader hits cache and the board paints with the rest
  // of the chrome instead of popping in after the surround. Declared
  // here (rather than just before the return) so dependent effects like
  // auto-roll can be gated on the same `gameShown` flag.
  const assetUrls = useMemo<readonly string[]>(() => {
    const list: string[] = [...GAMEPLAY_STATIC_ASSETS]
    if (selectedTheme.backgroundImage) list.push(selectedTheme.backgroundImage)
    if (selectedTheme.gameplayBackgroundImage) {
      list.push(selectedTheme.gameplayBackgroundImage)
    }
    if (selectedTheme.assets) {
      for (const value of Object.values(selectedTheme.assets)) {
        if (typeof value === "string" && value.length > 0) list.push(value)
      }
    }
    return list
  }, [selectedTheme])
  const {ready: assetsReady} = useImagePreloader(assetUrls)
  // BoardCanvas reports back when Pixi has actually drawn the first
  // frame. The loader overlay can only fade once that's true — fading
  // earlier reveals an empty board area while WebGL is still
  // initialising. Alignment-tool route bypasses this gate.
  const [boardReady, setBoardReady] = useState(false)
  const handleBoardReady = useCallback(() => {
    setBoardReady(true)
  }, [])
  // We defer mounting BoardCanvas until the theme has settled
  // (Supabase has either returned a remote config or confirmed there
  // isn't one). Mounting earlier means Pixi initialises with the
  // fallback theme and has to destroy + re-init when the remote
  // arrives — which briefly flashes an empty board.
  const canvasMountAllowed = !themeLoading || alignmentEnabled
  // Safety net: if Pixi init errors or stalls AFTER we've allowed the
  // canvas to mount, don't trap the user on the loader forever.
  // Reveal after 6s regardless — they'll see whatever the page
  // rendered, which beats an indefinite spinner.
  useEffect(() => {
    if (boardReady) return
    if (!canvasMountAllowed) return
    const id = window.setTimeout(() => {
      setBoardReady(true)
    }, 6000)
    return () => {
      window.clearTimeout(id)
    }
  }, [boardReady, canvasMountAllowed])
  const gameReady = assetsReady && (boardReady || alignmentEnabled)

  // Cover the screen with the overlay from the moment we mount, even on
  // a direct/cold load to /hotseat. useLayoutEffect runs before paint
  // so the overlay is composited in the same frame as the route's
  // first DOM commit — no flash of half-painted gameplay.
  useLayoutEffect(() => {
    if (alignmentEnabled) return
    showOverlay()
  }, [alignmentEnabled, showOverlay])

  // Once HTML images are cached AND Pixi has painted its first frame,
  // fade the overlay out to reveal the fully composed game screen.
  useEffect(() => {
    if (gameReady) hideOverlay()
  }, [gameReady, hideOverlay])

  const [autoRollOn, setAutoRollOn] = useAutoRoll()
  // Suppress auto-roll until the gameplay UI is fully revealed —
  // otherwise dice fly in the background while the loading screen is
  // up and the player sees the dice already settled when the board
  // appears.
  // The preference remains local, while the gameplay listener owns the
  // cancellable 350ms workflow. Include the route key so a re-entry with the
  // same cached assets republishes the effective eligibility.
  useEffect(() => {
    dispatch(autoRollEligibilityChanged({enabled: autoRollOn && gameReady}))
  }, [autoRollOn, dispatch, gameReady, routeKey])

  const turnLabel = matchOver ? "match over" : lastGameResult ? "game over" : pendingOffer ? `${pendingOffer === "white" ? "black" : "white"} decides` : isAIThinking ? `${board.turn} (AI) thinking…` : isAITurn ? `${board.turn} (AI)` : roll === null ? `${board.turn} to roll` : `${board.turn} to move`

  const showGameEndModal = (lastGameResult !== null || matchOver) && lastGameResult
  const showCubeDecision = pendingOffer !== null && !lastGameResult && !(aiConfig && pendingOffer !== aiConfig.player)
  const turnTimerActive = turnTimerEnabled && timer.deadlineMs !== null && !showGameEndModal && !showCubeDecision && !matchOver && !lastGameResult
  const showIntroBanner = introVisible && match.gameNumber === 1 && !lastGameResult && !matchOver && !alignmentEnabled

  // Local player is white in 2-player hot-seat (and when there's no AI);
  // when playing vs AI, the AI plays black and local player is white.
  const localColor = aiConfig ? (aiConfig.player === "black" ? "white" : "black") : "white"
  const opponentColor = localColor === "white" ? "black" : "white"
  const localPip = localColor === "white" ? whitePip : blackPip
  const opponentPip = opponentColor === "white" ? whitePip : blackPip
  const isLocalTurn = board.turn === localColor && !isAITurn
  const isRollForSelf = board.turn === localColor
  // Who opens THIS match (game 1). The opening turn is randomized per game by
  // the slice's randomFirstBoard (gameplayRouteEntered's prepare callback);
  // selectOpeningPlayer derives the opener live — turnLog[0].player once the
  // first turn is logged, board.turn before any roll — so the banner label
  // stays correct even after the opener (esp. the AI) takes its turn and
  // flips board.turn.
  const starterColor = useAppSelector(selectOpeningPlayer)
  const starterIsLocal = starterColor === localColor
  const selfLevel = progression.level
  const selfCoins = formatCompactNumber(wallet?.coins)
  // AI opponent's display level + coin count are derived from the
  // match id so each AI match looks like a different "player" while
  // staying deterministic per match (no flicker across re-renders).
  // Fallback persona for the brief window before matchId resolves —
  // see lib/aiPersona for the per-tier bands.
  const aiPersona = useMemo(() => (aiConfig ? generateAIPersona(matchId, aiConfig.level) : null), [aiConfig, matchId])
  const opponentLevel = aiPersona ? aiPersona.level : 23
  // Opponent coins are hidden ("—") to match the PvP panel, which never
  // reveals the opponent's balance. An AI opponent shows the same dash a real
  // opponent does, instead of a persona coin count (which would be a tell).
  const opponentCoinsLabel = "—"
  const opponentState = aiConfig ? aiRankLabel(aiConfig.level) : "Guest"
  const doublesLabel = match.cube.value > 1 ? String(match.cube.value) : "0"
  // Only hand a real background URL to BoardLayout once the theme has
  // settled AND the image is preloaded. Before that we'd be passing the
  // fallback (premium green) URL, which the loader overlay covers — but
  // if the overlay's fade timing is ever off, an <img src> swap from
  // fallback → remote leaks through as a flash of the wrong board art.
  const gameplayBackground = canvasMountAllowed && assetsReady ? selectedTheme.gameplayBackgroundImage ?? selectedTheme.backgroundImage : undefined

  // Note: no early-return loading gate here. The full JSX (including
  // BoardCanvas) renders behind the route-spanning overlay so Pixi can
  // initialise while the loader is up, and onReady can fire to release
  // the overlay on a fully composed screen.

  return (<BoardLayout
    actionsOverlay={!alignmentEnabled && !showGameEndModal && !showCubeDecision ? (<ActionButtons
      canEndTurn={canEndTurn && humanCanInteract}
      canRoll={playerCanRoll}
      canUndo={canUndo}
      onEndTurn={handleEndTurn}
      onRoll={handleRoll}
      onUndo={handleUndo}/>) : null}
    backgroundImage={gameplayBackground}
    centerOverlay={showCubeDecision ? (<CubeOfferDecision
      currentValue={match.cube.value}
      offeredBy={pendingOffer}
      onAccept={handleAcceptDouble}
      onDrop={handleDropDouble}/>) : showGameEndModal ? (<EndOfGameModal
      match={match}
      matchOver={matchOver}
      result={lastGameResult}
      reward={matchReward ? {
        xpAwarded: matchReward.xpAwarded,
        xpMultiplier: matchReward.xpMultiplier,
        coinsAwarded: matchReward.coinsAwarded,
      } : null}
      onNewMatch={() => {
        showOverlay()
        navigate("/play")
      }}
      onNextGame={handleNextGame}/>) : showIntroBanner ? (<button
      className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm hover:brightness-105 active:scale-95 transition cursor-pointer"
      type="button"
      onClick={() => {
        setIntroVisible(false)
      }}>
      <div className="font-display text-2xl uppercase tracking-wider mb-1">
        {starterIsLocal ? "You roll first" : `${opponentIdentity.name} rolls first`}
      </div>
      <div className="text-sm">
        {starterIsLocal ? `You start the match as ${starterColor}.` : `${opponentIdentity.name} starts the match as ${starterColor}.`}
      </div>
      <div className="text-[11px] text-amber-900/60 mt-2">Tap to dismiss</div>
    </button>) : null}
    header={<MatchHeader
      blackName={selfIdentity.name}
      blackPip={localPip}
      inCrawford={inCrawfordGame}
      match={match}
      turnLabel={turnLabel}
      whiteName={opponentIdentity.name}
      whitePip={opponentPip}/>}
    opponent={{
      identity: opponentIdentity,
      pipCount: opponentPip,
      scoreLabel: `${match.score[opponentColor]} / ${match.target}`,
      doublesLabel,
      level: opponentLevel,
      stateLabel: opponentState,
      coinsLabel: opponentCoinsLabel,
      isTurn: !isLocalTurn && !showGameEndModal,
      timerDeadlineMs: !isLocalTurn && turnTimerActive ? (timer.deadlineMs ?? undefined) : undefined,
      timerDurationMs: !isLocalTurn && turnTimerActive ? (timer.durationMs ?? undefined) : undefined,
    }}
    self={{
      identity: selfIdentity,
      pipCount: localPip,
      scoreLabel: `${match.score[localColor]} / ${match.target}`,
      doublesLabel,
      level: selfLevel,
      stateLabel: progression.statusLabel,
      coinsLabel: selfCoins,
      isTurn: isLocalTurn && !showGameEndModal,
      timerDeadlineMs: isLocalTurn && turnTimerActive ? (timer.deadlineMs ?? undefined) : undefined,
      timerDurationMs: isLocalTurn && turnTimerActive ? (timer.durationMs ?? undefined) : undefined, // Cube / Double / Auto live UNDER the local player's details (their
      // panel's bottom slot), matching the reference layout. Gated the same
      // way as the primary action overlay below.
      bottomSlot: !alignmentEnabled && !showGameEndModal && !showCubeDecision ? (<MatchSecondaryControls
        autoRollSlot={<AutoRollToggle
          enabled={autoRollOn}
          variant="inline"
          onChange={setAutoRollOn}/>}
        canDouble={canOfferDouble}
        cubeValue={match.cube.value}
        showCube={match.target > 1}
        onDouble={handleOfferDouble}/>) : undefined,
    }}>
    <HotSeatBoardSurface
      alignmentDebug={alignmentDebug}
      alignmentEnabled={alignmentEnabled}
      alignmentLayout={alignmentLayout}
      canvasMountAllowed={canvasMountAllowed}
      selectedTheme={selectedTheme}
      settleSide={isRollForSelf ? "right" : "left"}
      onReady={handleBoardReady}/>
    {alignmentEnabled && (<AlignmentPanel
      debug={alignmentDebug}
      layout={alignmentLayout}
      stackCount={alignmentStackCount}
      onDebugChange={setAlignmentDebug}
      onLayoutChange={setAlignmentLayout}
      onReset={() => {
        window.localStorage.removeItem(ALIGNMENT_STORAGE_KEY)
        setAlignmentLayout(basePremiumLayout())
      }}/>)}
  </BoardLayout>)
}
