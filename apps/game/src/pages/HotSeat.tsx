import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useState} from "react"

import {useNavigate, useSearchParams} from "react-router-dom"

import {AI_LEVELS, type AILevel} from "../../../../packages/ai/src/types"
import type {AlignmentDebugSelection} from "../../../../packages/board-renderer/src/pixi/types"
import {premiumTheme} from "../../../../packages/board-renderer/src/theme/premium"
import type {ThemeLayout} from "../../../../packages/board-renderer/src/theme/types"
import {ActionButtons} from "../components/ActionButtons"
import {AlignmentPanel} from "../components/AlignmentPanel"
import {BoardLayout} from "../components/BoardLayout"
import {CubeOfferDecision} from "../components/CubeOfferDecision"
import {EndOfGameModal} from "../components/EndOfGameModal"
import {useNavigationLoaderOverlay} from "../features/appUi/useNavigationLoaderOverlay"
import {autoRollEligibilityChanged} from "../features/gameplay/gameplayActions"
import {gameplayFinishCacheKey, useFinishMatchRpcMutation} from "../features/gameplay/gameplayApi"
import {
  selectBoard,
  selectCanEndTurn,
  selectCanOfferDouble,
  selectCanRoll,
  selectCanUndo,
  selectCubeDecisionVisible,
  selectHumanCanInteract,
  selectLastGameResult,
  selectLocalColor,
  selectMatch,
  selectMatchOver,
  selectPendingOffer,
} from "../features/gameplay/gameplaySelectors"
import {
  type AIConfig,
  DEFAULT_TURN_SECONDS,
  gameplayActions,
} from "../features/gameplay/gameplaySlice"
import {HotSeatBoardSurface} from "../features/gameplay/HotSeatBoardSurface"
import {HotSeatIntroBanner} from "../features/gameplay/HotSeatIntroBanner"
import {HotSeatMatchHeader} from "../features/gameplay/HotSeatMatchHeader"
import {HotSeatPlayerPanel} from "../features/gameplay/HotSeatPlayerPanel"
import {useBoardThemeConfig} from "../features/lobby/boardTheme"
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
    dispatch(gameplayActions.gameplayRouteEntered({
      sessionId: gameplaySessionId,
      presetMatchId,
      target,
      ai: aiConfig,
      turnSeconds: requestedTurnSeconds,
      turnTimerEnabled,
    }))
    return () => {
      dispatch(gameplayActions.gameplayRouteExited())
    }
  }, [dispatch, gameplaySessionId, presetMatchId, target, aiConfig, requestedTurnSeconds, turnTimerEnabled])

  const handleRoll = useCallback(() => {
    dispatch(gameplayActions.diceRolled())
  }, [dispatch])
  const handleEndTurn = useCallback(() => {
    dispatch(gameplayActions.turnEnded())
  }, [dispatch])
  const handleUndo = useCallback(() => {
    dispatch(gameplayActions.lastMoveUndone())
  }, [dispatch])
  const handleOfferDouble = useCallback(() => {
    dispatch(gameplayActions.doubleOffered())
  }, [dispatch])
  const handleAcceptDouble = useCallback(() => {
    dispatch(gameplayActions.doubleAccepted())
  }, [dispatch])
  const handleDropDouble = useCallback(() => {
    dispatch(gameplayActions.doubleDropped())
  }, [dispatch])
  const handleNextGame = useCallback(() => {
    dispatch(gameplayActions.gameContinued())
  }, [dispatch])
  // Rewards (XP + coins) granted by the server-side finish_match RPC.
  // Read from the mutation result in RTK Query so the end-of-game modal can
  // show "+50 XP / +200 coins"; the wallet/profile/XP refresh happens in the
  // gameplay listener so the lobby's top bar is correct when the user returns.
  const [, {data: matchReward}] = useFinishMatchRpcMutation({
    fixedCacheKey: gameplayFinishCacheKey(gameplaySessionId),
  })
  const match = useAppSelector(selectMatch)
  const board = useAppSelector(selectBoard)
  const canEndTurn = useAppSelector(selectCanEndTurn)
  const canOfferDouble = useAppSelector(selectCanOfferDouble)
  const canUndo = useAppSelector(selectCanUndo)
  const showCubeDecision = useAppSelector(selectCubeDecisionVisible)
  // Local player is white in 2-player hot-seat (and when there's no AI);
  // when playing vs AI, the AI plays black and local player is white.
  const localColor = useAppSelector(selectLocalColor)
  const pendingOffer = useAppSelector(selectPendingOffer)
  const lastGameResult = useAppSelector(selectLastGameResult)
  const matchOver = useAppSelector(selectMatchOver)
  const humanCanInteract = useAppSelector(selectHumanCanInteract)
  const playerCanRoll = useAppSelector(selectCanRoll)
  const alignmentPointIndex = alignmentDebug.side === "bottom" ? 12 + alignmentDebug.column : 11 - alignmentDebug.column
  const alignmentStackCount = board.points[alignmentPointIndex]?.count ?? 5
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

  const showGameEndModal = (lastGameResult !== null || matchOver) && lastGameResult
  const showIntroBanner = introVisible && match.gameNumber === 1 && !lastGameResult && !matchOver && !alignmentEnabled

  const isRollForSelf = board.turn === localColor
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

  return (
    <BoardLayout
      actionsOverlay={!alignmentEnabled && !showGameEndModal && !showCubeDecision ? (
        <ActionButtons
          canEndTurn={canEndTurn && humanCanInteract}
          canRoll={playerCanRoll}
          canUndo={canUndo}
          onEndTurn={handleEndTurn}
          onRoll={handleRoll}
          onUndo={handleUndo}/>
      ) : null}
      backgroundImage={gameplayBackground}
      centerOverlay={showCubeDecision && pendingOffer !== null ? (
        <CubeOfferDecision
          currentValue={match.cube.value}
          offeredBy={pendingOffer}
          onAccept={handleAcceptDouble}
          onDrop={handleDropDouble}/>
      ) : showGameEndModal ? (<EndOfGameModal
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
        onNextGame={handleNextGame}/>) : showIntroBanner ? (<HotSeatIntroBanner
        onDismiss={() => {
          setIntroVisible(false)
        }}/>) : null}
      header={<HotSeatMatchHeader/>}
      opponentPanel={<HotSeatPlayerPanel
        seat="opponent"/>}
      selfPanel={(
        <HotSeatPlayerPanel
          autoRollEnabled={autoRollOn}
          canDouble={canOfferDouble}
          controlsVisible={!alignmentEnabled && !showGameEndModal && !showCubeDecision}
          seat="self"
          onAutoRollChange={setAutoRollOn}
          onDouble={handleOfferDouble}/>
      )}>
      <HotSeatBoardSurface
        alignmentDebug={alignmentDebug}
        alignmentEnabled={alignmentEnabled}
        alignmentLayout={alignmentLayout}
        canvasMountAllowed={canvasMountAllowed}
        selectedTheme={selectedTheme}
        settleSide={isRollForSelf ? "right" : "left"}
        onReady={handleBoardReady}/>
      {alignmentEnabled && (
        <AlignmentPanel
          debug={alignmentDebug}
          layout={alignmentLayout}
          stackCount={alignmentStackCount}
          onDebugChange={setAlignmentDebug}
          onLayoutChange={setAlignmentLayout}
          onReset={() => {
            window.localStorage.removeItem(ALIGNMENT_STORAGE_KEY)
            setAlignmentLayout(basePremiumLayout())
          }}/>
      )}
    </BoardLayout>)
}
