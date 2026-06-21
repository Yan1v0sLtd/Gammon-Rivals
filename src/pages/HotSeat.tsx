import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import BoardCanvas from '../board/BoardCanvas';
import DiceTray from '../components/DiceTray';
import CubeOfferDecision from '../components/CubeOfferDecision';
import EndOfGameModal from '../components/EndOfGameModal';
import MatchHeader from '../components/MatchHeader';
import BoardLayout from '../components/BoardLayout';
import ActionButtons, { MatchSecondaryControls } from '../components/ActionButtons';
import AutoRollToggle from '../components/AutoRollToggle';
import AlignmentPanel from '../components/AlignmentPanel';
import { useGame, type AIConfig, type TurnRecord } from '../game/useGame';
import { pipCount } from '../engine';
import type { Position } from '../engine/types';
import type { GameResult, MatchState } from '../engine';
import { useBoardThemeConfig, type ThemeLayout } from '../board/theme';
import { premiumTheme } from '../board/theme/premium';
import type { AlignmentDebugSelection } from '../board/pixi/BoardRenderer';
import { AI_LEVELS, type AILevel } from '../ai';
import { useAuth } from '../lib/auth';
import { formatCompactNumber } from '../lib/format';
import { useNavigationOverlay } from '../lib/navigationOverlay';
import {
  createMatch,
  finishMatch,
  finishMatchRpc,
  modeFromAi,
  saveGame,
  type FinishMatchRewardResult,
} from '../lib/persistence';
import {
  aiRankLabel,
  makeAIIdentity,
  makeGuestIdentity,
  type PlayerIdentity,
} from '../lib/identity';
import { generateAIPersona } from '../lib/aiPersona';
import { useAutoRoll, useAutoRollEffect } from '../lib/useAutoRoll';
import { useImagePreloader } from '../lib/useImagePreloader';

// Static gameplay chrome — header art, action-button icons, etc. — that
// every match shares regardless of board theme. Pre-fetched so the
// game-screen renders fully composed.
const GAMEPLAY_STATIC_ASSETS: readonly string[] = [
  '/gameplay/premium-purple/auto.webp',
  '/gameplay/premium-purple/cube.webp',
  '/gameplay/premium-purple/double.webp',
  '/gameplay/premium-purple/end-turn-square.webp',
  '/gameplay/premium-purple/header.webp',
  '/gameplay/premium-purple/left-player.webp',
  '/gameplay/premium-purple/left-timer.webp',
  '/gameplay/premium-purple/player-stats.webp',
  '/gameplay/premium-purple/right-player.webp',
  '/gameplay/premium-purple/right-timer.webp',
  '/gameplay/premium-purple/roll.webp',
  '/gameplay/premium-purple/settings.webp',
  '/gameplay/premium-purple/stats.webp',
  '/gameplay/premium-purple/undo-square.webp',
  '/gameplay/premium-purple/undo.webp',
];

function parseOpponent(raw: string | null): AIConfig | null {
  if (!raw || raw === 'hotseat') return null;
  if ((AI_LEVELS as readonly string[]).includes(raw)) {
    return { player: 'black', level: raw as AILevel };
  }
  return null;
}

function parseTarget(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  // Default 1: quick-match (single game). N-point matches still work
  // when explicitly requested via ?target=N, kept for future tournaments.
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

const ALIGNMENT_STORAGE_KEY = 'gammon-rivals:premium-alignment-layout';
const DEFAULT_TURN_SECONDS = 45;

/** Clamp the URL-sourced turn timer to the same range the server enforces
 *  on table_configs.turn_seconds, so a forged `?turn=` query param can't
 *  trigger a 1-second timeout in the client. */
function parseTurnSeconds(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TURN_SECONDS;
  return Math.min(600, Math.max(5, n));
}

function copyRatios(value: readonly number[] | undefined): number[] | undefined {
  return value?.length === 12 ? [...value] : undefined;
}

function basePremiumLayout(): ThemeLayout {
  // Alignment tool's reset target. Boards are managed via Back Office
  // and bring their own layouts; this fallback uses the generic
  // premium theme so the alignment tool has a baseline to nudge from.
  const layout = premiumTheme.layout ?? {};
  return {
    ...layout,
    topPointCenterXRatios: copyRatios(layout.topPointCenterXRatios),
    topPointTipXRatios: copyRatios(layout.topPointTipXRatios),
    bottomPointCenterXRatios: copyRatios(layout.bottomPointCenterXRatios),
    bottomPointTipXRatios: copyRatios(layout.bottomPointTipXRatios),
    topCheckerOffsetXRatios: copyRatios(layout.topCheckerOffsetXRatios),
    bottomCheckerOffsetXRatios: copyRatios(layout.bottomCheckerOffsetXRatios),
  };
}

function mergeAlignmentLayout(saved: ThemeLayout): ThemeLayout {
  const base = basePremiumLayout();
  return {
    ...base,
    topPointCenterXRatios: copyRatios(saved.topPointCenterXRatios) ?? base.topPointCenterXRatios,
    topPointTipXRatios: copyRatios(saved.topPointTipXRatios) ?? base.topPointTipXRatios,
    bottomPointCenterXRatios:
      copyRatios(saved.bottomPointCenterXRatios) ?? base.bottomPointCenterXRatios,
    bottomPointTipXRatios: copyRatios(saved.bottomPointTipXRatios) ?? base.bottomPointTipXRatios,
    topCheckerOffsetXRatios:
      copyRatios(saved.topCheckerOffsetXRatios) ?? base.topCheckerOffsetXRatios,
    bottomCheckerOffsetXRatios:
      copyRatios(saved.bottomCheckerOffsetXRatios) ?? base.bottomCheckerOffsetXRatios,
    pointHeightRatio: saved.pointHeightRatio ?? base.pointHeightRatio,
    topPointHeightRatio: saved.topPointHeightRatio ?? base.topPointHeightRatio,
    bottomPointHeightRatio: saved.bottomPointHeightRatio ?? base.bottomPointHeightRatio,
    topPointYRatio: saved.topPointYRatio ?? base.topPointYRatio,
    bottomPointYRatio: saved.bottomPointYRatio ?? base.bottomPointYRatio,
    checkerStackSpacingRatio: saved.checkerStackSpacingRatio ?? base.checkerStackSpacingRatio,
    topCheckerStackSpacingRatio:
      saved.topCheckerStackSpacingRatio ?? base.topCheckerStackSpacingRatio,
    bottomCheckerStackSpacingRatio:
      saved.bottomCheckerStackSpacingRatio ?? base.bottomCheckerStackSpacingRatio,
    topCheckerPaddingRatio: saved.topCheckerPaddingRatio ?? base.topCheckerPaddingRatio,
    bottomCheckerPaddingRatio: saved.bottomCheckerPaddingRatio ?? base.bottomCheckerPaddingRatio,
    blackOffTrayXRatio: saved.blackOffTrayXRatio ?? base.blackOffTrayXRatio,
    blackOffTrayTopRatio: saved.blackOffTrayTopRatio ?? base.blackOffTrayTopRatio,
    blackOffTrayHeightRatio: saved.blackOffTrayHeightRatio ?? base.blackOffTrayHeightRatio,
    whiteOffTrayXRatio: saved.whiteOffTrayXRatio ?? base.whiteOffTrayXRatio,
    whiteOffTrayTopRatio: saved.whiteOffTrayTopRatio ?? base.whiteOffTrayTopRatio,
    whiteOffTrayHeightRatio: saved.whiteOffTrayHeightRatio ?? base.whiteOffTrayHeightRatio,
    offCheckerStackSpacingRatio:
      saved.offCheckerStackSpacingRatio ?? base.offCheckerStackSpacingRatio,
    blackOffTrayTiltDeg: saved.blackOffTrayTiltDeg ?? base.blackOffTrayTiltDeg,
    whiteOffTrayTiltDeg: saved.whiteOffTrayTiltDeg ?? base.whiteOffTrayTiltDeg,
  };
}

function loadAlignmentLayout(): ThemeLayout {
  if (typeof window === 'undefined') return basePremiumLayout();
  const raw = window.localStorage.getItem(ALIGNMENT_STORAGE_KEY);
  if (!raw) return basePremiumLayout();
  try {
    return mergeAlignmentLayout(JSON.parse(raw) as ThemeLayout);
  } catch {
    return basePremiumLayout();
  }
}

export default function HotSeat() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { show: showOverlay, hide: hideOverlay } = useNavigationOverlay();
  const {
    user,
    profile,
    wallet,
    progression,
    isLoading: authLoading,
    refreshProfile,
    refreshWallet,
  } = useAuth();

  const opp = params.get('opp');
  const aiConfig = useMemo(() => parseOpponent(opp), [opp]);
  const target = useMemo(() => parseTarget(params.get('target')), [params]);
  // Board theme is a PER-CLIENT cosmetic — each player reads their
  // OWN selected theme from THEIR OWN URL's `?board=…` query param.
  // Matchmaking ignores theme entirely (see findMatchInTier in
  // src/lib/persistence.ts). Two players can be paired into the same
  // match with completely different themes on their screens.
  const boardParam = params.get('board');
  /**
   * When the difficulty modal calls enter_room(), the new match row is
   * created server-side before navigation. The modal then routes here
   * with ?matchId=<id>&turn=<seconds>. If those params are present we
   * reuse the existing match (skip the createMatch call below) and pick
   * up the per-room turn timer instead of the 45-second default.
   */
  const presetMatchId = params.get('matchId');
  const turnSeconds = useMemo(() => parseTurnSeconds(params.get('turn')), [params]);
  const { theme: selectedTheme, isLoading: themeLoading } = useBoardThemeConfig(boardParam);
  const alignmentEnabled = params.get('align') === '1';
  const [alignmentLayout, setAlignmentLayout] = useState<ThemeLayout>(() => loadAlignmentLayout());
  const [alignmentDebug, setAlignmentDebug] = useState<AlignmentDebugSelection>({
    enabled: true,
    side: 'bottom',
    column: 0,
    anchor: 'base',
  });

  useEffect(() => {
    if (!alignmentEnabled) return;
    window.localStorage.setItem(ALIGNMENT_STORAGE_KEY, JSON.stringify(alignmentLayout));
  }, [alignmentEnabled, alignmentLayout]);

  const game = useGame({ initialTarget: target, ai: aiConfig });
  const alignmentPointIndex =
    alignmentDebug.side === 'bottom' ? 12 + alignmentDebug.column : 11 - alignmentDebug.column;
  const alignmentStackCount = game.board.points[alignmentPointIndex]?.count ?? 5;
  const whitePip = pipCount(game.board, 'white');
  const blackPip = pipCount(game.board, 'black');

  // ---- Identities ----
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
      };
    }
    return makeGuestIdentity();
  }, [profile]);

  const opponentIdentity: PlayerIdentity = useMemo(
    () => (aiConfig ? makeAIIdentity() : makeGuestIdentity()),
    [aiConfig]
  );

  // ---- Persistence ----
  // If the difficulty modal pre-created the match via enter_room, skip
  // the local createMatch call entirely — the row already exists, the
  // entry fee was already debited server-side, and we should use that
  // id for all later writes (saveGame, finishMatch).
  const [matchId, setMatchId] = useState<string | null>(presetMatchId);
  const persistedGameNumberRef = useRef(0);
  const persistedMatchOverRef = useRef(false);
  const matchCreatedForUserRef = useRef<string | null>(presetMatchId ? 'preset' : null);

  useEffect(() => {
    if (authLoading || !user || matchId) return;
    if (matchCreatedForUserRef.current === user.id) return;
    matchCreatedForUserRef.current = user.id;
    (async () => {
      try {
        const id = await createMatch({
          ownerId: user.id,
          mode: modeFromAi(aiConfig),
          target,
        });
        setMatchId(id);
      } catch (err) {
        console.warn('createMatch failed', err);
      }
    })();
  }, [authLoading, user, matchId, aiConfig, target]);

  useEffect(() => {
    if (!matchId) return;
    if (!game.lastGameResult) return;
    if (persistedGameNumberRef.current >= game.match.gameNumber - (game.matchOver ? 0 : 1)) return;

    const result: GameResult = game.lastGameResult;
    const gameNumber = persistedGameNumberRef.current + 1;
    persistedGameNumberRef.current = gameNumber;

    const turnsForDb = (game.turnLog as readonly TurnRecord[]).map((t) => ({
      player: t.player,
      dice: t.dice,
      subMoves: t.subMoves,
      // null for AI turns and any turn that closed via an edge case
      // (we'd rather omit than back-fill a fabricated value).
      elapsedMs: t.elapsedMs,
    }));

    const wasCrawford =
      game.match.crawfordGameNumber !== null &&
      game.match.crawfordGameNumber === gameNumber;

    saveGame({
      matchId,
      gameNumber,
      result,
      cubeOwner: game.match.cube.owner,
      wasCrawford,
      moves: turnsForDb,
    }).catch((err) => {
      console.warn('saveGame failed', err);
    });
  }, [matchId, game.lastGameResult, game.match, game.matchOver, game.turnLog]);

  // Rewards (XP + coins) granted by the server-side finish_match RPC.
  // Captured here so a future end-of-game modal can show "+50 XP / +200
  // coins"; for now we just refresh auth state so the lobby's top bar
  // is correct when the user navigates home.
  const [matchReward, setMatchReward] = useState<FinishMatchRewardResult | null>(null);
  // Match-start "rolls first" banner — parity with the PvP (PlayOnline) intro.
  // The opening player is now RANDOM (randomFirstBoard in useGame), so the
  // banner names whoever actually starts (you or the opponent). Auto-dismisses
  // after a few seconds, or tap to dismiss.
  const [introVisible, setIntroVisible] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setIntroVisible(false), 4000);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!matchId) return;
    if (!game.matchOver) return;
    if (persistedMatchOverRef.current) return;
    persistedMatchOverRef.current = true;
    const winner = game.match.winner;
    if (!winner) return;
    // presetMatchId being set means the match was created by enter_room
    // and (if won) is eligible for XP/coin rewards. Route through the
    // RPC so the server can validate ownership + award atomically.
    // Other matches (legacy ?opp=... / online) keep using the plain
    // UPDATE in finishMatch().
    if (presetMatchId) {
      void finishMatchRpc({
        matchId,
        whiteScore: game.match.score.white,
        blackScore: game.match.score.black,
        winner,
        crawfordGameNumber: game.match.crawfordGameNumber,
      })
        .then((reward) => {
          setMatchReward(reward);
          void refreshWallet();
          void refreshProfile();
        })
        .catch((err) => {
          console.warn('finishMatch RPC failed', err);
        });
    } else {
      finishMatch({
        matchId,
        whiteScore: game.match.score.white,
        blackScore: game.match.score.black,
        winner,
        crawfordGameNumber: game.match.crawfordGameNumber,
      }).catch((err) => {
        console.warn('finishMatch failed', err);
      });
    }
  }, [matchId, game.matchOver, game.match, presetMatchId, refreshProfile, refreshWallet]);

  // ---- Asset preload gate ----
  // Statics + the selected theme's HTML backgrounds and Pixi textures.
  // Loading them via <img> warms the browser cache so BoardCanvas's
  // internal Pixi loader hits cache and the board paints with the rest
  // of the chrome instead of popping in after the surround. Declared
  // here (rather than just before the return) so dependent effects like
  // auto-roll can be gated on the same `gameShown` flag.
  const assetUrls = useMemo<readonly string[]>(() => {
    const list: string[] = [...GAMEPLAY_STATIC_ASSETS];
    if (selectedTheme.backgroundImage) list.push(selectedTheme.backgroundImage);
    if (selectedTheme.gameplayBackgroundImage) {
      list.push(selectedTheme.gameplayBackgroundImage);
    }
    if (selectedTheme.assets) {
      for (const value of Object.values(selectedTheme.assets)) {
        if (typeof value === 'string' && value.length > 0) list.push(value);
      }
    }
    return list;
  }, [selectedTheme]);
  const { ready: assetsReady } = useImagePreloader(assetUrls);
  // BoardCanvas reports back when Pixi has actually drawn the first
  // frame. The loader overlay can only fade once that's true — fading
  // earlier reveals an empty board area while WebGL is still
  // initialising. Alignment-tool route bypasses this gate.
  const [boardReady, setBoardReady] = useState(false);
  const handleBoardReady = useCallback(() => setBoardReady(true), []);
  // We defer mounting BoardCanvas until the theme has settled
  // (Supabase has either returned a remote config or confirmed there
  // isn't one). Mounting earlier means Pixi initialises with the
  // fallback theme and has to destroy + re-init when the remote
  // arrives — which briefly flashes an empty board.
  const canvasMountAllowed = !themeLoading || alignmentEnabled;
  // Safety net: if Pixi init errors or stalls AFTER we've allowed the
  // canvas to mount, don't trap the user on the loader forever.
  // Reveal after 6s regardless — they'll see whatever the page
  // rendered, which beats an indefinite spinner.
  useEffect(() => {
    if (boardReady) return;
    if (!canvasMountAllowed) return;
    const id = window.setTimeout(() => setBoardReady(true), 6000);
    return () => window.clearTimeout(id);
  }, [boardReady, canvasMountAllowed]);
  const gameReady = assetsReady && (boardReady || alignmentEnabled);

  // Cover the screen with the overlay from the moment we mount, even on
  // a direct/cold load to /hotseat. useLayoutEffect runs before paint
  // so the overlay is composited in the same frame as the route's
  // first DOM commit — no flash of half-painted gameplay.
  useLayoutEffect(() => {
    if (alignmentEnabled) return;
    showOverlay();
  }, [alignmentEnabled, showOverlay]);

  // Once HTML images are cached AND Pixi has painted its first frame,
  // fade the overlay out to reveal the fully composed game screen.
  useEffect(() => {
    if (gameReady) hideOverlay();
  }, [gameReady, hideOverlay]);

  // ---- Auto-roll preference ----
  const [autoRollOn, setAutoRollOn] = useAutoRoll();
  const humanCanInteract = !game.isAITurn && !game.isAIThinking;
  const playerCanRoll =
    game.roll === null && !game.lastGameResult && !game.matchOver && humanCanInteract;
  // Suppress auto-roll until the gameplay UI is fully revealed —
  // otherwise dice fly in the background while the loading screen is
  // up and the player sees the dice already settled when the board
  // appears.
  useAutoRollEffect(autoRollOn && gameReady, playerCanRoll, game.rollDice);

  // ---- Game UI ----
  const handlePointClick = (pos: Position) => {
    if (game.lastGameResult || game.matchOver) return;
    if (game.pendingOffer) return;
    if (!humanCanInteract) return;
    if (game.selectedFrom === null) {
      game.selectFrom(pos);
      return;
    }
    if (game.validDestinations.includes(pos)) {
      game.selectTo(pos);
    } else if (game.legalOrigins.includes(pos)) {
      game.selectFrom(pos);
    } else {
      game.cancelSelection();
    }
  };

  const turnLabel = game.matchOver
    ? 'match over'
    : game.lastGameResult
    ? 'game over'
    : game.pendingOffer
    ? `${game.pendingOffer === 'white' ? 'black' : 'white'} decides`
    : game.isAIThinking
    ? `${game.board.turn} (AI) thinking…`
    : game.isAITurn
    ? `${game.board.turn} (AI)`
    : game.roll === null
    ? `${game.board.turn} to roll`
    : `${game.board.turn} to move`;

  const showGameEndModal = (game.lastGameResult !== null || game.matchOver) && game.lastGameResult;
  const showCubeDecision =
    game.pendingOffer !== null &&
    !game.lastGameResult &&
    !(aiConfig && game.pendingOffer !== aiConfig.player);
  const turnTimerActive =
    !alignmentEnabled && !showGameEndModal && !showCubeDecision && !game.matchOver && !game.lastGameResult;
  const showIntroBanner =
    introVisible &&
    game.match.gameNumber === 1 &&
    !game.lastGameResult &&
    !game.matchOver &&
    !alignmentEnabled;
  const [timerNow, setTimerNow] = useState(() => performance.now());
  const turnTimerKey = `${game.match.gameNumber}:${game.board.turn}:${game.pendingOffer ?? 'play'}:${game.lastGameResult ? 'done' : 'active'}`;
  const [turnTimerState, setTurnTimerState] = useState(() => ({
    key: turnTimerKey,
    startedAt: performance.now(),
  }));
  const timeoutHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (turnTimerState.key === turnTimerKey) return;
    const reset = window.setTimeout(() => {
      const now = performance.now();
      setTurnTimerState({ key: turnTimerKey, startedAt: now });
      setTimerNow(now);
      timeoutHandledRef.current = null;
    }, 0);
    return () => window.clearTimeout(reset);
  }, [turnTimerKey, turnTimerState.key]);

  useEffect(() => {
    if (!turnTimerActive) return;
    const interval = window.setInterval(() => setTimerNow(performance.now()), 220);
    return () => window.clearInterval(interval);
  }, [turnTimerActive]);

  const turnElapsedSeconds = turnTimerActive ? (timerNow - turnTimerState.startedAt) / 1000 : 0;
  const turnSecondsLeft = Math.max(0, Math.ceil(turnSeconds - turnElapsedSeconds));
  const turnTimerProgress = Math.max(
    0,
    Math.min(1, (turnSeconds - turnElapsedSeconds) / turnSeconds)
  );
  const { forfeitTurn } = game;

  useEffect(() => {
    if (!turnTimerActive) return;
    if (!humanCanInteract) return;
    if (turnElapsedSeconds < turnSeconds) return;
    const key = `${game.match.gameNumber}:${game.board.turn}`;
    if (timeoutHandledRef.current === key) return;
    timeoutHandledRef.current = key;
    forfeitTurn();
  }, [
    forfeitTurn,
    game.board.turn,
    game.match.gameNumber,
    humanCanInteract,
    turnElapsedSeconds,
    turnSeconds,
    turnTimerActive,
  ]);

  // ---- Layout ----
  // Local player is white in 2-player hot-seat (and when there's no AI);
  // when playing vs AI, the AI plays black and local player is white.
  const localColor = aiConfig ? (aiConfig.player === 'black' ? 'white' : 'black') : 'white';
  const opponentColor = localColor === 'white' ? 'black' : 'white';
  const localPip = localColor === 'white' ? whitePip : blackPip;
  const opponentPip = opponentColor === 'white' ? whitePip : blackPip;
  const isLocalTurn = game.board.turn === localColor && !game.isAITurn;
  const isRollForSelf = game.board.turn === localColor;
  // Who opens THIS match (game 1). The opening turn is randomized per game in
  // useGame; capture the first observed turn so the banner label stays correct
  // even after the opener (esp. the AI) takes its turn and flips board.turn.
  const starterColorRef = useRef<'white' | 'black' | null>(null);
  if (starterColorRef.current === null) starterColorRef.current = game.board.turn;
  const starterColor = starterColorRef.current ?? game.board.turn;
  const starterIsLocal = starterColor === localColor;
  const selfLevel = progression.level;
  const selfCoins = formatCompactNumber(wallet?.coins);
  // AI opponent's display level + coin count are derived from the
  // match id so each AI match looks like a different "player" while
  // staying deterministic per match (no flicker across re-renders).
  // Fallback persona for the brief window before matchId resolves —
  // see lib/aiPersona for the per-tier bands.
  const aiPersona = useMemo(
    () => (aiConfig ? generateAIPersona(matchId, aiConfig.level) : null),
    [aiConfig, matchId]
  );
  const opponentLevel = aiPersona ? aiPersona.level : 23;
  // Opponent coins are hidden ("—") to match the PvP panel, which never
  // reveals the opponent's balance. An AI opponent shows the same dash a real
  // opponent does, instead of a persona coin count (which would be a tell).
  const opponentCoinsLabel = '—';
  const opponentState = aiConfig ? aiRankLabel(aiConfig.level) : 'Guest';
  const doublesLabel = game.match.cube.value > 1 ? String(game.match.cube.value) : '0';
  // Only hand a real background URL to BoardLayout once the theme has
  // settled AND the image is preloaded. Before that we'd be passing the
  // fallback (premium green) URL, which the loader overlay covers — but
  // if the overlay's fade timing is ever off, an <img src> swap from
  // fallback → remote leaks through as a flash of the wrong board art.
  const gameplayBackground =
    canvasMountAllowed && assetsReady
      ? selectedTheme.gameplayBackgroundImage ?? selectedTheme.backgroundImage
      : undefined;

  // Note: no early-return loading gate here. The full JSX (including
  // BoardCanvas) renders behind the route-spanning overlay so Pixi can
  // initialise while the loader is up, and onReady can fire to release
  // the overlay on a fully composed screen.

  return (
    <BoardLayout
      backgroundImage={gameplayBackground}
      header={
        <MatchHeader
          match={game.match as MatchState}
          whitePip={opponentPip}
          blackPip={localPip}
          turnLabel={turnLabel}
          inCrawford={game.inCrawfordGame}
          whiteName={opponentIdentity.name}
          blackName={selfIdentity.name}
        />
      }
      opponent={{
        identity: opponentIdentity,
        pipCount: opponentPip,
        scoreLabel: `${game.match.score[opponentColor]} / ${game.match.target}`,
        doublesLabel,
        level: opponentLevel,
        stateLabel: opponentState,
        coinsLabel: opponentCoinsLabel,
        isTurn: !isLocalTurn && !showGameEndModal,
        timerProgress: !isLocalTurn && turnTimerActive ? turnTimerProgress : undefined,
        timerSecondsLeft: !isLocalTurn && turnTimerActive ? turnSecondsLeft : undefined,
      }}
      self={{
        identity: selfIdentity,
        pipCount: localPip,
        scoreLabel: `${game.match.score[localColor]} / ${game.match.target}`,
        doublesLabel,
        level: selfLevel,
        stateLabel: progression.statusLabel,
        coinsLabel: selfCoins,
        isTurn: isLocalTurn && !showGameEndModal,
        timerProgress: isLocalTurn && turnTimerActive ? turnTimerProgress : undefined,
        timerSecondsLeft: isLocalTurn && turnTimerActive ? turnSecondsLeft : undefined,
        // Cube / Double / Auto live UNDER the local player's details (their
        // panel's bottom slot), matching the reference layout. Gated the same
        // way as the primary action overlay below.
        bottomSlot:
          !alignmentEnabled && !showGameEndModal && !showCubeDecision ? (
            <MatchSecondaryControls
              canDouble={game.canOfferDouble}
              onDouble={game.offerDouble}
              cubeValue={game.match.cube.value}
              showCube={game.match.target > 1}
              autoRollSlot={
                <AutoRollToggle
                  enabled={autoRollOn}
                  onChange={setAutoRollOn}
                  variant="inline"
                />
              }
            />
          ) : undefined,
      }}
      actionsOverlay={
        !alignmentEnabled && !showGameEndModal && !showCubeDecision ? (
          <ActionButtons
            canRoll={playerCanRoll}
            onRoll={game.rollDice}
            canEndTurn={game.canEndTurn && humanCanInteract}
            onEndTurn={game.endTurn}
            canUndo={game.canUndo}
            onUndo={game.undoLastMove}
          />
        ) : null
      }
      centerOverlay={
        showCubeDecision ? (
          <CubeOfferDecision
            offeredBy={game.pendingOffer!}
            currentValue={game.match.cube.value}
            onAccept={game.acceptDouble}
            onDrop={game.dropDouble}
          />
        ) : showGameEndModal ? (
          <EndOfGameModal
            result={game.lastGameResult!}
            match={game.match}
            matchOver={game.matchOver}
            reward={
              matchReward
                ? {
                    xpAwarded: matchReward.xpAwarded,
                    xpMultiplier: matchReward.xpMultiplier,
                    coinsAwarded: matchReward.coinsAwarded,
                  }
                : null
            }
            onNextGame={game.nextGame}
            onNewMatch={() => {
              showOverlay();
              navigate('/play');
            }}
          />
        ) : showIntroBanner ? (
          <button
            type="button"
            onClick={() => setIntroVisible(false)}
            className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm hover:brightness-105 active:scale-95 transition cursor-pointer"
          >
            <div className="font-display text-2xl uppercase tracking-wider mb-1">
              {starterIsLocal ? 'You roll first' : `${opponentIdentity.name} rolls first`}
            </div>
            <div className="text-sm">
              {starterIsLocal
                ? `You start the match as ${starterColor}.`
                : `${opponentIdentity.name} starts the match as ${starterColor}.`}
            </div>
            <div className="text-[11px] text-amber-900/60 mt-2">Tap to dismiss</div>
          </button>
        ) : null
      }
    >
      {canvasMountAllowed ? (
        <BoardCanvas
          state={game.board}
          theme={selectedTheme}
          layoutOverride={alignmentEnabled ? alignmentLayout : undefined}
          selection={{
            selectedFrom: !alignmentEnabled && humanCanInteract ? game.selectedFrom : null,
            validDestinations: !alignmentEnabled && humanCanInteract ? game.validDestinations : [],
            legalOrigins: !alignmentEnabled && humanCanInteract ? game.legalOrigins : [],
            opponentOrigins: alignmentEnabled ? [] : game.opponentPreviewOrigins,
            opponentDestinations: alignmentEnabled ? [] : game.opponentPreviewDestinations,
            alignmentDebug: alignmentEnabled ? alignmentDebug : undefined,
          }}
          onPointClick={alignmentEnabled ? undefined : handlePointClick}
          onReady={handleBoardReady}
        />
      ) : null}
      <DiceTray
        roll={game.roll}
        remaining={game.remaining}
        settleSide={isRollForSelf ? 'right' : 'left'}
        themeSprite={selectedTheme.diceImage}
      />
      {alignmentEnabled && (
        <AlignmentPanel
          layout={alignmentLayout}
          debug={alignmentDebug}
          stackCount={alignmentStackCount}
          onDebugChange={setAlignmentDebug}
          onLayoutChange={setAlignmentLayout}
          onReset={() => {
            window.localStorage.removeItem(ALIGNMENT_STORAGE_KEY);
            setAlignmentLayout(basePremiumLayout());
          }}
        />
      )}
    </BoardLayout>
  );
}
