import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useShop } from '../features/appUi/useShop';
import { useNavigationLoaderOverlay } from '../features/appUi/useNavigationLoaderOverlay';
import { abandonStaleMatches } from '../features/lobby/matchmakingData';
import { isSupabaseConfigured } from '../lib/supabase';
import { useMarkTutorialCompleteMutation } from '../features/lobby/lobbyApi';
import {
  boardPurchaseModalOpened,
  boardSelected,
  dailyBonusAutoOpenRequested,
  dailyBonusModalOpened,
  difficultyModalOpened,
  howToPlayModalOpened,
  lobbyRouteEntered,
  lobbyRouteExited,
  missionsModalOpened,
  wheelModalOpened,
} from '../features/lobby/lobbySlice';
import { selectIsLobbyModalOpen } from '../features/lobby/lobbySelectors';
import { useImagePreloader } from '../lib/useImagePreloader';
import { usePrefetchOnIdle } from '../lib/usePrefetchOnIdle';
import { useBodyModalFlag } from '../lib/bodyModalFlag';
import { setPersistedBoardId } from '../board/theme/selectedBoard';
import { BoardLockTooltip } from './BoardLockTooltip';
import { LobbyBoardCarousel } from './LobbyBoardCarousel';
import { LobbyBottomNav } from './LobbyBottomNav';
import { useWheelState } from './useWheelState';
import { useDailyMissions } from './useDailyMissions';
import { LobbySideOffers } from './LobbySideOffers';
import { LobbyTopBar } from './LobbyTopBar';
import type { LobbyBoard } from './lobbyData';
import { RewardFlight } from './RewardFlight';
import { useDailyBonus } from './useDailyBonus';
import { useSelectedLobbyBoard } from './useSelectedLobbyBoard';
import { computeBoardState, useUserBoardInventory } from './useUserBoardInventory';
import { useLobbyFeatureConfigs } from './useLobbyFeatureConfigs';
import { OnboardingTour } from './OnboardingTour';
import { LobbyModalHost } from './LobbyModalHost';
import { useRewardFlights } from './useRewardFlights';
import { useAppDispatch, useAppSelector } from '../store/hooks';

// Static lobby assets — referenced unconditionally by sub-components,
// so they're always part of the first-paint preload. Per-board imagery
// (backgrounds, previews) is added dynamically once Supabase resolves.
const LOBBY_STATIC_ASSETS: readonly string[] = [
  '/lobby/carousel/gem.webp',
  '/lobby/holders/royal-holder.webp',
  '/lobby/icons/friends.webp',
  '/lobby/icons/gem.webp',
  '/lobby/icons/gold-coin.webp',
  '/lobby/icons/online-players.webp',
  '/lobby/icons/rewards-gift.webp',
  '/lobby/icons/settings-gear.webp',
  '/lobby/icons/trophy.webp',
  '/lobby/cards/coins-offer.webp',
  '/lobby/cards/daily-bonus.webp',
  '/lobby/nav/events.webp',
  '/lobby/nav/missions.webp',
  '/lobby/nav/nav-bg.webp',
  '/lobby/nav/tournaments.webp',
  '/lobby/nav/vip-club.webp',
];

// Tier-1 "open next" assets: NOT needed for first paint, but high-probability
// the player opens them soon (Play → difficulty popup, How-to-Play). Prefetched
// in the background once the lobby is interactive (see usePrefetchOnIdle) so
// these sections appear instantly instead of flashing their images in a beat
// later. Board art is deliberately NOT here — the carousel lazy-loads ±2 boards
// as you scroll, so this stays small + scalable as boards grow.
const LOBBY_SECONDARY_ASSETS: readonly string[] = [
  '/lobby/difficulties/beginner.webp',
  '/lobby/difficulties/advanced.webp',
  '/lobby/difficulties/pro.webp',
  '/lobby/difficulties/expert.webp',
  '/lobby/difficulties/grand-master.webp',
  '/lobby/cards/how-to-play-popup.webp',
];

/**
 * One full-screen background layer. THE FLICKER RULE: the screen must be
 * covered by a fully-painted layer at every frame of a board switch. Two
 * things used to break that on phones (fine on desktop, where decode is
 * ~instant from cache):
 *   1. Layers were keyed by ROLE (`entering-${id}` / `leaving-${id}`), so
 *      the board that switched from entering→leaving REMOUNTED as a fresh
 *      <img> — which a memory-pressured phone re-DECODES, painting blank
 *      for a few frames → dark flash.
 *   2. The incoming layer began its fade before its image was decoded.
 * Now layers are keyed by BOARD id (the element survives role changes, so
 * its img stays painted), and an entering layer holds at opacity 0 until
 * its image is decoded (`--entering-pending`), only then fading in over
 * the still-opaque previous board. `onEntered` fires on animationend so
 * the parent prunes the old layer exactly when it's fully covered.
 */
function LobbyBackgroundLayer({
  board,
  mode,
  onEntered,
}: {
  readonly board: LobbyBoard;
  readonly mode: 'current' | 'leaving' | 'entering';
  readonly onEntered?: (boardId: LobbyBoard['id']) => void;
}) {
  // Decode gate — only the entering role waits; current/leaving are
  // already-painted layers (or the initial board behind the loader).
  const [ready, setReady] = useState(mode !== 'entering');
  useEffect(() => {
    if (mode !== 'entering' || ready) return;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(true);
    };
    const img = new Image();
    img.src = board.background;
    if (typeof img.decode === 'function') {
      img.decode().then(markReady, markReady);
    } else if (img.complete) {
      markReady();
    } else {
      img.onload = markReady;
      img.onerror = markReady;
    }
    // Failsafe: never hold the new board hostage to a stuck decode.
    const failsafe = window.setTimeout(markReady, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
    };
  }, [mode, ready, board.background]);

  const stateClass =
    mode === 'leaving'
      ? 'lobby-background-layer--leaving'
      : mode === 'entering'
        ? ready
          ? 'lobby-background-layer--entering'
          : 'lobby-background-layer--entering-pending'
        : 'lobby-background-layer--current';

  return (
    <div
      className={`lobby-background-layer fixed inset-0 ${stateClass}`}
      aria-hidden="true"
      onAnimationEnd={
        mode === 'entering' && ready
          ? (event) => {
              if (event.target === event.currentTarget) onEntered?.(board.id);
            }
          : undefined
      }
    >
      <img
        src={board.background}
        alt=""
        className="h-full w-full object-cover"
        // No CSS blur here (mobile perf): a filter on a FULL-SCREEN image
        // forces the GPU to hold + re-filter a huge offscreen surface. The
        // tone overlay below already softens the art.
        draggable={false}
      />
      <div className="absolute inset-0" style={{ background: board.backgroundTone }} />
    </div>
  );
}

export function LobbyScreen() {
  const dispatch = useAppDispatch();
  const { openShop } = useShop();
  const { show: showOverlay, hide: hideOverlay } = useNavigationLoaderOverlay();
  const { profile, user, wallet, progression, isGuest, linkGoogleIdentity, refreshWallet } = useAuth();
  const {
    boards,
    isLoading: boardsLoading,
    effectiveSelectedBoardId,
    selectedBoard,
  } = useSelectedLobbyBoard();
  const { ownedIds } = useUserBoardInventory();
  const { flights, spawnFlights, removeFlight } = useRewardFlights();
  const [lockedTooltipFor, setLockedTooltipFor] = useState<LobbyBoard | null>(null);
  // Stable handler for BoardLockTooltip's onDismiss. The tooltip
  // lists onDismiss in its setTimeout effect's dep array, so an
  // inline closure (new identity every parent render) would cancel
  // the running 3-second timer on each re-render and the tooltip
  // would never auto-dismiss.
  const dismissLockedTooltip = useCallback(() => setLockedTooltipFor(null), []);
  // Bottom-nav feature gating (Missions/Events/Tournaments/VIP). The lock badge
  // + "Reach level X" pill are rendered inside LobbyBottomNav itself.
  const featureConfigs = useLobbyFeatureConfigs();
  // Warm "open next" section art (difficulty heroes, How-to-Play) in the
  // background once the lobby is interactive — no first-open flash.
  usePrefetchOnIdle(LOBBY_SECONDARY_ASSETS);
  const dailyBonus = useDailyBonus();
  const wheel = useWheelState('main');
  // While ANY full-screen lobby modal is up, flag <body> so the ambient
  // lobby animations (Sunbeam, XP flow, shimmer, halo) pause — they're
  // invisible behind the backdrop but phones still paid for every frame.
  const isModalOpen = useAppSelector(selectIsLobbyModalOpen);
  useBodyModalFlag(isModalOpen);
  const missionsResult = useDailyMissions(profile?.id);
  const missionsClaimableBadge =
    missionsResult.state?.missions.filter((m) => m.completed_at && !m.claimed_at).length ?? 0;

  // Route enter/exit resets the lobby slice (modal, selected board,
  // daily-bonus auto-open latch), mirroring the Replay pattern.
  useEffect(() => {
    dispatch(lobbyRouteEntered());
    return () => {
      dispatch(lobbyRouteExited());
    };
  }, [dispatch]);

  // First-run onboarding tour. Shows once: the source of truth is
  // profiles.tutorial_completed_at (follows the account across devices and the
  // guest→Google upgrade); a localStorage mirror suppresses it instantly after
  // dismissal so it can't flash again before the profile row refetches.
  const [tourDismissed, setTourDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('gr_tutorial_done') === '1'
  );
  const tourPending =
    !!user && !!profile && profile.tutorial_completed_at == null && !tourDismissed;
  const [markTutorialComplete] = useMarkTutorialCompleteMutation();
  const handleTourDone = useCallback(() => {
    setTourDismissed(true);
    try {
      localStorage.setItem('gr_tutorial_done', '1');
    } catch {
      // Private mode / storage disabled — the DB flag below still persists it.
    }
    if (isSupabaseConfigured) {
      void markTutorialComplete().then((result) => {
        if (result.error) console.warn('mark_tutorial_complete failed', result.error.message);
      });
    }
  }, [markTutorialComplete]);

  const boardStateOf = (board: LobbyBoard) =>
    computeBoardState({
      boardId: board.id,
      unlockLevel: board.unlockLevel,
      priceGems: board.priceGems,
      ownedIds,
      playerLevel: progression.level,
    });

  const handleLockedTap = (board: LobbyBoard) => {
    setLockedTooltipFor(board);
  };

  // Auto-popup the daily bonus modal once per lobby session when the player
  // can claim — canClaim flips false after a claim, so it won't auto-popup
  // again the same day.
  useEffect(() => {
    // Let the first-run tour finish before the daily-bonus modal auto-opens —
    // otherwise a brand-new player gets both at once. When the tour is
    // dismissed tourPending flips false and this effect re-runs to open it.
    if (tourPending) return;
    if (!user || !dailyBonus.canClaim || dailyBonus.isLoading) return;
    if (dailyBonus.configs.length === 0) return;
    // The open-at-most-once latch lives in the slice (dailyBonusAutoOpened),
    // so re-running this effect is safe.
    dispatch(dailyBonusAutoOpenRequested());
  }, [user, dailyBonus.canClaim, dailyBonus.isLoading, dailyBonus.configs.length, tourPending, dispatch]);

  // Persist the player's current board pick so match screens reached WITHOUT a
  // `?board=` param (invite links, public/queue matches, cold loads) can
  // recover it via useBoardThemeConfig and never fall through to the generic
  // placeholder board.
  useEffect(() => {
    setPersistedBoardId(effectiveSelectedBoardId);
  }, [effectiveSelectedBoardId]);

  const previousBoardRef = useRef<LobbyBoard | null>(selectedBoard ?? null);
  const [fadingBoard, setFadingBoard] = useState<LobbyBoard | null>(null);
  // Board ids whose background has actually painted at full opacity at
  // least once. Only such boards may serve as the opaque "leaving" layer —
  // promoting a never-painted board there would flash the dark base
  // through (the exact flicker this crossfade exists to prevent).
  const paintedBoardsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedBoard) return;
    const previousBoard = previousBoardRef.current;
    if (!previousBoard || previousBoard.id === selectedBoard.id) {
      // Initial board (or no-op change): it renders as the always-opaque
      // 'current' layer, so count it as painted.
      paintedBoardsRef.current.add(selectedBoard.id);
      previousBoardRef.current = selectedBoard;
      return;
    }

    // Keep the OLD board on screen (fully opaque) while the new one decodes
    // + fades in above it. If the previous board never finished painting
    // (rapid scrolling past boards), keep whatever fully-painted board is
    // already serving as the backdrop instead.
    if (paintedBoardsRef.current.has(previousBoard.id)) {
      setFadingBoard(previousBoard);
    }
    previousBoardRef.current = selectedBoard;
  }, [selectedBoard]);

  // The entering layer finished its fade-in at full opacity → it now fully
  // covers the old board, which can be pruned with zero visual change.
  const handleBackgroundEntered = useCallback((boardId: LobbyBoard['id']) => {
    paintedBoardsRef.current.add(boardId);
    setFadingBoard(null);
  }, []);

  // Failsafe prune: animationend can be missed (tab hidden pauses CSS
  // animations). By 3s the crossfade is long over — or invisible anyway.
  useEffect(() => {
    if (!fadingBoard) return;
    const id = window.setTimeout(() => setFadingBoard(null), 3000);
    return () => window.clearTimeout(id);
  }, [fadingBoard]);

  // ---- Asset preload gate ----
  // Don't paint the lobby until the boards data is resolved AND every
  // image (statics + per-board previews/backgrounds) has loaded. Latch
  // the gate open after first success so a late-arriving board (e.g. a
  // new theme added in Back Office) doesn't re-hide the screen.
  const assetUrls = useMemo<readonly string[]>(() => {
    const list: string[] = [...LOBBY_STATIC_ASSETS];
    for (const board of boards) {
      if (board.image) list.push(board.image);
      if (board.background) list.push(board.background);
    }
    return list;
  }, [boards]);
  const { ready: assetsReady } = useImagePreloader(assetUrls);
  const lobbyReady = assetsReady && !boardsLoading;

  // Cover the screen with the overlay from the moment we mount, even
  // on a cold load. useLayoutEffect runs before paint so the overlay
  // is composited in the same frame as the route's first DOM commit.
  useLayoutEffect(() => {
    showOverlay();
  }, [showOverlay]);

  // Once Supabase has returned and every image has loaded, fade the
  // overlay out to reveal the fully composed lobby underneath.
  useEffect(() => {
    if (lobbyReady) hideOverlay();
  }, [lobbyReady, hideOverlay]);

  // Finalise any difficulty-room match the player left unfinished (bailed
  // mid-game, closed the tab, crashed). Lobby-load is the natural "back to home
  // base" moment and this screen re-mounts on every return from a match, so a
  // just-abandoned match gets forfeit-finalised here — which also fires the
  // matches_progress_missions trigger, so "Play N matches" finally counts it.
  // Age floor of 1 minute (the RPC's minimum): there's no resume-a-match flow,
  // and this only runs while the player is ON the lobby (never mid-play), so a
  // short window is safe — it just settles the already-paid entry-fee stake.
  // Refresh the wallet afterwards so any lose-prize shows in the top bar.
  const abandonRanForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    if (!isSupabaseConfigured) return;
    if (abandonRanForUserRef.current === user.id) return;
    abandonRanForUserRef.current = user.id;
    (async () => {
      try {
        const count = await abandonStaleMatches(1);
        if (count > 0) void refreshWallet();
      } catch (err) {
        console.warn('abandonStaleMatches failed', err);
      }
    })();
  }, [user, refreshWallet]);

  // Note: no early-return loading gate here. The full lobby JSX renders
  // behind the route-spanning overlay so any internal layout work
  // settles while the loader is up — the overlay fades on lobbyReady to
  // reveal a stable, fully painted view.

  // Side-rail offer routing, shared by the left rail (Special Offers) and
  // the right rail (Daily Bonus + How to Play). Daily Bonus opens
  // unconditionally (the modal still surfaces the 7-day grid even when
  // already claimed today); Coins routes to /shop; Connect opens the tutorial.
  const handleOfferClick = (offerId: string) => {
    if (offerId === 'daily') dispatch(dailyBonusModalOpened());
    else if (offerId === 'coins') openShop();
    else if (offerId === 'connect') dispatch(howToPlayModalOpened());
  };

  return (
    <main className="lobby-screen relative min-h-dvh overflow-x-hidden bg-[#071120] text-white">
      {/* Keys are the BOARD id (not the role) so a board switching from
          entering→leaving keeps its DOM element — its already-painted img
          never remounts/re-decodes (the old remount was the mobile dark
          flicker). DOM order puts the leaving layer first = painted below. */}
      {fadingBoard && fadingBoard.id !== selectedBoard?.id ? (
        <LobbyBackgroundLayer key={`bg-${fadingBoard.id}`} board={fadingBoard} mode="leaving" />
      ) : null}
      {selectedBoard ? (
        <LobbyBackgroundLayer
          key={`bg-${selectedBoard.id}`}
          board={selectedBoard}
          mode={fadingBoard && fadingBoard.id !== selectedBoard.id ? 'entering' : 'current'}
          onEntered={handleBackgroundEntered}
        />
      ) : null}

      <div className="lobby-shell relative z-10 flex min-h-dvh flex-col px-4 pb-0 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-9">
        <LobbyTopBar
          profile={profile}
          wallet={wallet}
          progression={progression}
          isGuest={isGuest}
          onLinkGoogle={() => linkGoogleIdentity({ redirectTo: `${window.location.origin}/auth/callback?next=/play` })}
        />

        {/* Layout is fully owned by `.lobby-main-grid` in index.css (the
            absolute, 3-column `minmax(0,1fr) [board] minmax(0,1fr)` canvas
            grid). The old Tailwind `xl:grid-cols-[18.5rem_…]` /
            `2xl:grid-cols-…` utilities were overriding that rule on desktop
            (≥1280px) — a 2-column [rail | board] grid that pushed the board
            into an offset right column, so the board was centred on mobile
            but off-centre on web. Removed so the index.css grid wins on
            every breakpoint and the board is consistently screen-centred. */}
        <div className="lobby-main-grid">
          {/* Left rail: Special Offers only (stays put per operator). */}
          <LobbySideOffers
            offerIds={['coins']}
            side="left"
            onOfferClick={handleOfferClick}
          />

          <div className="lobby-board-region min-w-0">
            <LobbyBoardCarousel
              boards={boards}
              selectedId={effectiveSelectedBoardId}
              onSelectedIdChange={(id) => dispatch(boardSelected(id))}
              onPlay={() => dispatch(difficultyModalOpened())}
              getBoardState={boardStateOf}
              onLockedTap={handleLockedTap}
              onPurchaseTap={(board) => dispatch(boardPurchaseModalOpened(board.id))}
              walletGems={wallet?.gems ?? 0}
            />
          </div>

          {/* Right rail: Daily Bonus (top, level with Special Offers) +
              How to Play below it. Moved here from the left per operator. */}
          <LobbySideOffers
            offerIds={['daily', 'connect']}
            side="right"
            onOfferClick={handleOfferClick}
          />

          {/* Play Friends + Tournaments cards removed per operator
              direction. Hotseat ("two players on this device") is
              still accessible through the bottom-nav; Tournaments
              doesn't have a feature behind it yet, so the card was
              just placeholder. */}
        </div>

        <LobbyBottomNav
          wheel={wheel}
          onClaimWheel={() => {
            // Open the wheel modal only when the cooldown has actually
            // elapsed. The lobby pill already gates by canSpin, but
            // double-check here so a stale click during a re-fetch
            // doesn't open the modal in the wrong state.
            if (wheel.canSpin) dispatch(wheelModalOpened());
          }}
          onOpenMissions={() => dispatch(missionsModalOpened())}
          missionsBadge={missionsClaimableBadge}
          featureConfigs={featureConfigs}
          playerLevel={progression.level}
        />
      </div>

      {lockedTooltipFor ? (
        <BoardLockTooltip
          key={`tooltip-${lockedTooltipFor.id}`}
          requiredLevel={lockedTooltipFor.unlockLevel}
          onDismiss={dismissLockedTooltip}
        />
      ) : null}

      <LobbyModalHost onSpawnFlights={spawnFlights} />

      {/* Flying coin / gem tokens rendered above everything else. */}
      {flights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}

      {/* First-run onboarding tour — only once the lobby is fully painted
          (balances loaded, board rendered) so the spotlight never lands on a
          skeleton. Gated to brand-new players via profiles.tutorial_completed_at. */}
      {lobbyReady && tourPending ? <OnboardingTour onDone={handleTourDone} /> : null}
    </main>
  );
}
