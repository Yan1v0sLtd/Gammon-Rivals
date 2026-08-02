import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// AILevel import dropped along with the startMatch handler.
import { useAuth } from '../lib/auth';
import { useShop } from '../features/appUi/useShop';
import { extractErrorMessage } from '../../../../packages/shared/src/errors';
import { useNavigationLoaderOverlay } from '../features/appUi/useNavigationLoaderOverlay';
import {
  abandonStaleMatches,
  cancelMatchmakingRpc,
  enterRoomAiFallback,
  findMatchInTier,
} from '../lib/persistence';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useImagePreloader } from '../lib/useImagePreloader';
import { usePrefetchOnIdle } from '../lib/usePrefetchOnIdle';
import { useBodyModalFlag } from '../lib/bodyModalFlag';
import { setPersistedBoardId } from '../board/theme/selectedBoard';
import { BoardLockTooltip } from './BoardLockTooltip';
import { BoardPurchaseModal } from './BoardPurchaseModal';
import { DailyBonusModal } from './DailyBonusModal';
import { HowToPlayModal } from './HowToPlayModal';
import {
  DifficultyModal,
  type DifficultySelection,
  type MatchmakingOverlayState,
} from './DifficultyModal';
// LobbyActionCard import removed — the Play Friends + Tournaments
// cards that used it were dropped from the right-rail per operator
// direction. Component file still exists in case the cards return.
import { LobbyBoardCarousel } from './LobbyBoardCarousel';
import { LobbyBottomNav } from './LobbyBottomNav';
import { useWheelState } from './useWheelState';
import { WheelModal } from './WheelModal';
import { DailyMissionsModal } from './DailyMissionsModal';
import { useDailyMissions } from './useDailyMissions';
import { LobbySideOffers } from './LobbySideOffers';
import { LobbyTopBar } from './LobbyTopBar';
import type { LobbyBoard, LobbyBoardId } from './lobbyData';
import { RewardFlight, type RewardFlightSpec, type FlightCurrency } from './RewardFlight';
import { useDailyBonus } from './useDailyBonus';
import { useLobbyBoards } from './useLobbyBoards';
import { computeBoardState, useUserBoardInventory } from './useUserBoardInventory';
import { useLobbyFeatureConfigs } from './useLobbyFeatureConfigs';
import { OnboardingTour } from './OnboardingTour';

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

// type OpponentChoice = 'hotseat' | AILevel;  ← used by the
// now-removed startMatch handler (Play Friends + Tournaments
// cards). Kept commented so a re-add is one line.

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
  const navigate = useNavigate();
  const { openShop } = useShop();
  const { show: showOverlay, hide: hideOverlay } = useNavigationLoaderOverlay();
  const { profile, user, wallet, progression, isGuest, linkGoogleIdentity, refreshWallet, refreshProfile } = useAuth();
  const { boards, isLoading: boardsLoading } = useLobbyBoards();
  const { ownedIds, refetch: refetchInventory } = useUserBoardInventory();
  const [selectedBoardId, setSelectedBoardId] = useState<LobbyBoardId>('');
  // startOnline / creatingOnline / onlineError were removed alongside
  // the "Play Online" side card. Every match now flows through
  // handleDifficultySelect (PvP-first → AI fallback), so the legacy
  // public-lobby online-create path is no longer reachable from this
  // surface. createOnlineMatch is still exported from persistence for
  // invite-code flows and the back-office.
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
  const [purchaseTarget, setPurchaseTarget] = useState<LobbyBoard | null>(null);
  // Difficulty modal state. `enteringRoomId` is the table_config_id
  // currently being purchased via enter_room — the modal uses it to
  // disable just the tapped card while the RPC is in flight.
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  const [enteringRoomId, setEnteringRoomId] = useState<string | null>(null);
  const [difficultyError, setDifficultyError] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const dailyBonus = useDailyBonus();
  const wheel = useWheelState('main');
  const [wheelModalOpen, setWheelModalOpen] = useState(false);
  const [dailyBonusOpen, setDailyBonusOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [missionsModalOpen, setMissionsModalOpen] = useState(false);
  // While ANY full-screen lobby modal is up, flag <body> so the ambient
  // lobby animations (Sunbeam, XP flow, shimmer, halo) pause — they're
  // invisible behind the backdrop but phones still paid for every frame.
  useBodyModalFlag(
    difficultyOpen ||
      !!purchaseTarget ||
      wheelModalOpen ||
      howToPlayOpen ||
      missionsModalOpen ||
      dailyBonusOpen,
  );
  const missionsResult = useDailyMissions(profile?.id);
  const missionsClaimableBadge =
    missionsResult.state?.missions.filter((m) => m.completed_at && !m.claimed_at).length ?? 0;
  const [isClaimingDailyBonus, setIsClaimingDailyBonus] = useState(false);
  const [dailyBonusError, setDailyBonusError] = useState<string | null>(null);
  const [justClaimedBonus, setJustClaimedBonus] = useState<{
    day: number;
    coins: number;
    gems: number;
    xp: number;
  } | null>(null);
  const autoOpenedDailyBonusRef = useRef(false);
  const [rewardFlights, setRewardFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(0);

  // First-run onboarding tour. Shows once: the source of truth is
  // profiles.tutorial_completed_at (follows the account across devices and the
  // guest→Google upgrade); a localStorage mirror suppresses it instantly after
  // dismissal so it can't flash again before the profile row refetches.
  const [tourDismissed, setTourDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('gr_tutorial_done') === '1'
  );
  const tourPending =
    !!user && !!profile && profile.tutorial_completed_at == null && !tourDismissed;
  const handleTourDone = useCallback(() => {
    setTourDismissed(true);
    try {
      localStorage.setItem('gr_tutorial_done', '1');
    } catch {
      // Private mode / storage disabled — the DB flag below still persists it.
    }
    if (isSupabaseConfigured) {
      void supabase.rpc('mark_tutorial_complete').then(({ error }) => {
        if (error) console.warn('mark_tutorial_complete failed', error);
      });
    }
  }, []);

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

  const handlePurchaseTap = (board: LobbyBoard) => {
    setPurchaseError(null);
    setPurchaseTarget(board);
  };

  const purchaseErrorMessage = (code: string, board: LobbyBoard): string => {
    switch (code) {
      case 'insufficient_gems':
        return 'Not enough gems.';
      case 'level_too_low':
        return `Reach level ${board.unlockLevel} to unlock.`;
      case 'already_owned':
        return 'You already own this board.';
      case 'board_not_purchasable':
        return 'This board is not available for purchase.';
      case 'board_disabled':
      case 'board_not_found':
        return 'Board unavailable.';
      case 'not_authenticated':
        return 'Sign in to purchase boards.';
      default:
        return code;
    }
  };

  const confirmPurchase = async () => {
    if (!purchaseTarget || isPurchasing) return;
    if (!isSupabaseConfigured || !user) {
      setPurchaseError('Sign in to purchase boards.');
      return;
    }
    setIsPurchasing(true);
    setPurchaseError(null);
    const board = purchaseTarget;
    const { error } = await supabase.rpc('purchase_board_with_gems', {
      target_board_id: board.id,
    });
    setIsPurchasing(false);
    if (error) {
      setPurchaseError(purchaseErrorMessage(error.message, board));
      return;
    }
    setPurchaseTarget(null);
    refetchInventory();
  };

  const dailyBonusErrorMessage = (code: string): string => {
    switch (code) {
      case 'already_claimed':
        return "You've already claimed today's bonus.";
      case 'not_authenticated':
        return 'Sign in to claim daily bonuses.';
      default:
        // config_missing_for_day_N and anything else: surface the raw code.
        return code;
    }
  };

  const openDailyBonus = () => {
    setDailyBonusError(null);
    setJustClaimedBonus(null);
    setDailyBonusOpen(true);
  };

  /** Spawn a burst of flying tokens from the just-claimed day card's gem
   *  to the matching wallet pill in the top bar. Coins fly to the coins
   *  pill; gems fly to the gems pill. Each currency gets `count` tokens
   *  with a small staggered delay so the flight reads as a stream. */
  const spawnFlights = (currency: FlightCurrency, sourceEl: Element, count: number) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
    if (!target) return;
    const src = sourceEl.getBoundingClientRect();
    const dst = target.getBoundingClientRect();
    const startX = src.left + src.width / 2;
    const startY = src.top + src.height / 2;
    const endX = dst.left + dst.width / 2;
    const endY = dst.top + dst.height / 2;
    const additions: RewardFlightSpec[] = [];
    for (let i = 0; i < count; i++) {
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (Math.random() - 0.5) * 14,
        startY: startY + (Math.random() - 0.5) * 14,
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 800,
      });
    }
    setRewardFlights((prev) => [...prev, ...additions]);
  };

  const removeFlight = (id: number) => {
    setRewardFlights((prev) => prev.filter((f) => f.id !== id));
  };

  const claimDailyBonus = async () => {
    if (isClaimingDailyBonus) return;
    if (!isSupabaseConfigured || !user) {
      setDailyBonusError('Sign in to claim daily bonuses.');
      return;
    }
    // Capture each currency's source element BEFORE the modal
    // re-renders into its claimed state (which can move / remove
    // icons). Both queries scope to the active day card — the
    // modal now stamps `data-fly-source` only on the active day,
    // so querySelector returns that card's icon. Each currency
    // gets its own source so e.g. coins fly from the coin icon and
    // gems from the gem icon (used to share the gem source, which
    // was visually wrong on coin-only days like Day 1 / Day 4
    // anyway since there's no gem icon there).
    const gemsSourceEl = document.querySelector('[data-fly-source="gems"]');
    const coinsSourceEl = document.querySelector('[data-fly-source="coins"]');

    setIsClaimingDailyBonus(true);
    setDailyBonusError(null);
    const { data, error } = await supabase.rpc('claim_daily_bonus');
    setIsClaimingDailyBonus(false);
    if (error) {
      setDailyBonusError(dailyBonusErrorMessage(error.message));
      return;
    }
    const payload = data as {
      day_claimed?: number;
      reward_coins?: number;
      reward_gems?: number;
      reward_xp?: number;
    } | null;
    if (!payload || typeof payload.day_claimed !== 'number') return;

    const reward = {
      day: payload.day_claimed,
      coins: payload.reward_coins ?? 0,
      gems: payload.reward_gems ?? 0,
      xp: payload.reward_xp ?? 0,
    };
    setJustClaimedBonus(reward);

    // Spawn the flying tokens before refreshing the wallet so the user
    // sees the coins / gems travel and *then* land on a bumped balance.
    // Each currency uses its OWN source icon when present. Fallback to
    // the other source if a card was configured with only one icon —
    // better the flight starts from a nearby card than vanishes
    // entirely.
    if (reward.gems > 0) {
      const src = gemsSourceEl ?? coinsSourceEl;
      if (src) spawnFlights('gems', src, 6);
    }
    if (reward.coins > 0) {
      const src = coinsSourceEl ?? gemsSourceEl;
      if (src) spawnFlights('coins', src, 6);
    }

    // Refresh streak state (so canClaim flips to false), wallet
    // (so the top-bar counter ticks up around the time the
    // flights land), AND profile (so the level progress bar
    // reflects any XP the daily bonus credited).
    dailyBonus.refetch();
    window.setTimeout(() => {
      void refreshWallet();
      void refreshProfile();
    }, 600);

    // Hold the modal open long enough to see the CLAIMED card and the
    // flight, then auto-dismiss.
    window.setTimeout(() => {
      setDailyBonusOpen(false);
      setJustClaimedBonus(null);
    }, 1800);
  };

  // Auto-popup the daily bonus modal once per lobby session if the player
  // can claim. canClaim flips to false after a successful claim, so we
  // won't auto-popup again the same day. With the close button removed,
  // the modal is now claim-only — never opens when there's nothing to do.
  useEffect(() => {
    if (autoOpenedDailyBonusRef.current) return;
    // Let the first-run tour finish before the daily-bonus modal auto-opens —
    // otherwise a brand-new player gets both at once. When the tour is
    // dismissed tourPending flips false and this effect re-runs to open it.
    if (tourPending) return;
    if (!user || !dailyBonus.canClaim || dailyBonus.isLoading) return;
    if (dailyBonus.configs.length === 0) return;
    autoOpenedDailyBonusRef.current = true;
    setDailyBonusOpen(true);
  }, [user, dailyBonus.canClaim, dailyBonus.isLoading, dailyBonus.configs.length, tourPending]);
  const effectiveSelectedBoardId = boards.some((board) => board.id === selectedBoardId)
    ? selectedBoardId
    : (boards[0]?.id ?? '');

  // Persist the player's current board pick so match screens reached WITHOUT a
  // `?board=` param (invite links, public/queue matches, cold loads) can
  // recover it via useBoardThemeConfig and never fall through to the generic
  // placeholder board.
  useEffect(() => {
    setPersistedBoardId(effectiveSelectedBoardId);
  }, [effectiveSelectedBoardId]);

  // selectedBoard may be undefined briefly before useLobbyBoards's DB
  // fetch resolves (or if no boards are configured in the back office).
  // All downstream code now treats it as optional.
  const selectedBoard = boards.find((board) => board.id === effectiveSelectedBoardId) ?? boards[0];
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

  // startMatch was the click handler for Play Friends (hotseat)
  // and Tournaments (AI). Both cards were removed from the
  // right-rail per operator direction. The function is kept as
  // a commented stub so a re-add is a one-import flip.
  // const startMatch = (opponent: OpponentChoice, target = 1) => { ... };

  /**
   * Matchmaking overlay state. Renders inside the DifficultyModal
   * while we're polling find_match_in_tier between PLAY click and
   * either a PvP pair or the AI fallback.
   */
  const [matchmaking, setMatchmaking] = useState<MatchmakingOverlayState | null>(null);
  // Cancel flag shared with the running poll loop. We use a ref rather
  // than reading state inside the loop to avoid stale closures.
  const cancelMatchmakingRef = useRef(false);

  /**
   * PvP-first match entry. On PLAY:
   *   1. Validate board ownership defensively.
   *   2. Open the matchmaking overlay; loop find_match_in_tier every
   *      500ms for up to MAX_MATCH_SECONDS.
   *   3. On a 'matched' status, route into the PvP match. Both
   *      players land on the same matchId via the server-side row.
   *   4. On timeout (still 'queued'), cancel matchmaking + call
   *      enter_room_ai_fallback (which picks AI level from caller's
   *      pvp_rating with cfg.ai_level as floor) and route to /hotseat.
   *   5. Errors at any stage close the overlay with a friendly toast.
   */
  const MATCHMAKING_MAX_SECONDS = 4;
  const MATCHMAKING_POLL_MS = 500;

  const handleDifficultySelect = async (selection: DifficultySelection) => {
    if (enteringRoomId !== null) return;
    if (!user) {
      setDifficultyError('Sign in to enter a room.');
      return;
    }
    if (selectedBoard) {
      const state = boardStateOf(selectedBoard);
      if (state !== 'owned' && state !== 'free-unlock') {
        setDifficultyError('Unlock this board before entering a room.');
        return;
      }
    }

    setEnteringRoomId(selection.tableConfigId);
    setDifficultyError(null);
    cancelMatchmakingRef.current = false;
    const searchStart = Date.now();
    setMatchmaking({
      searchingForTier: selection.tableConfigId,
      tierDisplayName: selection.displayName,
      elapsedSeconds: 0,
      maxSeconds: MATCHMAKING_MAX_SECONDS,
    });

    const friendlyError = (err: unknown): string => {
      // extractErrorMessage handles both JS Error instances AND the
      // plain-object PostgrestError shape Supabase RPCs reject with —
      // the previous `String(err)` fallback rendered the latter as
      // the useless literal "[object Object]".
      const msg = extractErrorMessage(err);
      if (msg.includes('insufficient_coins')) return 'Not enough coins for this room.';
      if (msg.includes('level_too_low')) {
        return 'This room is locked at your current level.';
      }
      if (msg.includes('room_disabled')) return 'This room is temporarily unavailable.';
      if (msg.includes('pvp_not_allowed_in_tier')) {
        return 'PvP isn’t enabled in this room.';
      }
      if (msg.includes('ai_not_allowed')) return 'AI play is disabled in this room.';
      if (msg.includes('room_not_found')) return 'Room not found — try refreshing.';
      if (msg.includes('not_authenticated')) return 'Sign in to enter a room.';
      if (msg.includes('profile_missing')) {
        return 'Profile not ready yet — try again in a moment.';
      }
      if (msg.includes('stale_client_reload')) {
        return 'New version available — please refresh the page.';
      }
      // Final fallback: surface the raw error so we can debug
      // production issues without a re-deploy.
      console.error('[LobbyScreen] enter-room failure', err);
      return msg ? `Could not enter the room: ${msg}` : 'Could not enter the room. Try again.';
    };

    const routeIntoMatch = (
      matchId: string,
      target: number,
      turnSeconds: number,
      mode: 'pvp' | string
    ) => {
      const params = new URLSearchParams();
      params.set('opp', mode === 'pvp' ? 'pvp' : mode);
      params.set('target', String(target));
      // `board` is THIS PLAYER's selected theme — written into their
      // own URL only. The matched opponent runs this same code in
      // their own client and writes their OWN selection. Two players
      // end up with different `?board=…` values pointing at the same
      // matchId. The matches table has no board column; theme is a
      // pure per-client cosmetic and is NOT a matchmaking dimension.
      // See findMatchInTier in src/lib/persistence.ts.
      params.set('board', effectiveSelectedBoardId);
      params.set('matchId', matchId);
      params.set('turn', String(turnSeconds));
      showOverlay();
      setDifficultyOpen(false);
      setMatchmaking(null);
      // Online matches (PvP, or a server-bot match: mode='online') route to
      // /play/:matchId; legacy client-side AI fallbacks continue to /hotseat.
      navigate(
        mode === 'pvp' || mode === 'online'
          ? `/play/${matchId}?${params.toString()}`
          : `/hotseat?${params.toString()}`
      );
    };

    try {
      // 1. Poll loop for PvP match.
      let matched: Awaited<ReturnType<typeof findMatchInTier>> | null = null;
      while (Date.now() - searchStart < MATCHMAKING_MAX_SECONDS * 1000) {
        if (cancelMatchmakingRef.current) break;
        const result = await findMatchInTier({
          tableConfigId: selection.tableConfigId,
        });
        if (result.status === 'matched' && result.matchId) {
          matched = result;
          break;
        }
        // Tick the overlay counter so the user sees the countdown move.
        const elapsed = (Date.now() - searchStart) / 1000;
        setMatchmaking((curr) =>
          curr
            ? {
                ...curr,
                elapsedSeconds: Math.min(MATCHMAKING_MAX_SECONDS, elapsed),
              }
            : curr
        );
        await new Promise((resolve) => setTimeout(resolve, MATCHMAKING_POLL_MS));
      }

      if (cancelMatchmakingRef.current) {
        // User cancelled — clean up the server-side queue entry.
        await cancelMatchmakingRpc().catch(() => undefined);
        setMatchmaking(null);
        return;
      }

      if (matched && matched.matchId) {
        void refreshWallet();
        routeIntoMatch(
          matched.matchId,
          matched.target ?? selection.matchTarget,
          matched.turnSeconds ?? selection.turnSeconds,
          'pvp'
        );
        return;
      }

      // 2. Timeout — fall back to AI at this tier.
      await cancelMatchmakingRpc().catch(() => undefined);
      const fallback = await enterRoomAiFallback({ tableConfigId: selection.tableConfigId });
      void refreshWallet();
      // Server-bot tiers come back as mode='online' (is_bot) → route to /play
      // (server-authoritative). Legacy tiers route to /hotseat by ai level.
      routeIntoMatch(
        fallback.matchId,
        fallback.target,
        fallback.turnSeconds,
        fallback.isBot ? 'online' : fallback.aiLevel
      );
    } catch (err) {
      setMatchmaking(null);
      setDifficultyError(friendlyError(err));
      await cancelMatchmakingRpc().catch(() => undefined);
    } finally {
      setEnteringRoomId(null);
    }
  };

  const handleCancelMatchmaking = () => {
    cancelMatchmakingRef.current = true;
  };

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
    if (offerId === 'daily') openDailyBonus();
    else if (offerId === 'coins') openShop();
    else if (offerId === 'connect') setHowToPlayOpen(true);
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
              onSelectedIdChange={setSelectedBoardId}
              onPlay={() => {
                setDifficultyError(null);
                setDifficultyOpen(true);
              }}
              getBoardState={boardStateOf}
              onLockedTap={handleLockedTap}
              onPurchaseTap={handlePurchaseTap}
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
              still accessible through the bottom-nav or invite-code
              join flow; Tournaments doesn't have a feature behind
              it yet, so the card was just placeholder. */}
        </div>

        <LobbyBottomNav
          wheel={wheel}
          onClaimWheel={() => {
            // Open the wheel modal only when the cooldown has actually
            // elapsed. The lobby pill already gates by canSpin, but
            // double-check here so a stale click during a re-fetch
            // doesn't open the modal in the wrong state.
            if (wheel.canSpin) setWheelModalOpen(true);
          }}
          onOpenMissions={() => setMissionsModalOpen(true)}
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

      {purchaseTarget ? (
        <BoardPurchaseModal
          boardName={purchaseTarget.name}
          priceGems={purchaseTarget.priceGems}
          isPurchasing={isPurchasing}
          errorMessage={purchaseError}
          onConfirm={confirmPurchase}
          onCancel={() => {
            if (isPurchasing) return;
            setPurchaseTarget(null);
            setPurchaseError(null);
          }}
        />
      ) : null}

      {missionsModalOpen ? (
        <DailyMissionsModal
          result={missionsResult}
          onClose={() => {
            setMissionsModalOpen(false);
            // Claims/rerolls/chests may have credited the wallet
            // AND XP — refresh both so the top-bar RollingNumber
            // and the level progress bar catch up.
            void refreshWallet();
            void refreshProfile();
          }}
        />
      ) : null}

      {wheelModalOpen ? (
        <WheelModal
          wheel={wheel}
          onClose={() => setWheelModalOpen(false)}
          onProgressionUpdated={() => {
            // Fires when the wheel lands + XP flights spawn —
            // ~1500ms BEFORE the modal closes. The lobby's
            // XP progress bar (visible through the translucent
            // backdrop) updates while the XP tokens are still
            // flying toward the level hex, so the bar fills
            // smoothly during the flight animation.
            void refreshProfile();
          }}
          onSpinComplete={() => {
            // Fires when the modal is about to close. Refresh
            // wallet (so RollingNumber ticks the new total AFTER
            // coin/gem flights land — visual cause→effect) and
            // re-fetch the wheel state so the lobby pill flips
            // back to its cooldown countdown.
            void refreshWallet();
            wheel.refetch();
          }}
        />
      ) : null}

      {dailyBonusOpen ? (
        <DailyBonusModal
          configs={dailyBonus.configs}
          upcomingDay={dailyBonus.upcomingDay}
          canClaim={dailyBonus.canClaim}
          isClaiming={isClaimingDailyBonus}
          errorMessage={dailyBonusError}
          justClaimed={justClaimedBonus}
          daysClaimedInCurrentStreak={dailyBonus.daysClaimedInCurrentStreak}
          onClaim={claimDailyBonus}
          onClose={() => setDailyBonusOpen(false)}
        />
      ) : null}

      {howToPlayOpen ? (
        <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />
      ) : null}

      <DifficultyModal
        open={difficultyOpen}
        onClose={() => {
          if (enteringRoomId !== null) return;
          setDifficultyOpen(false);
          setDifficultyError(null);
        }}
        onSelect={handleDifficultySelect}
        onGetCoins={() => {
          // No showOverlay() here — /shop renders instantly and doesn't
          // hide the route overlay on mount, which would trap the user
          // on a permanent loading screen. The lobby's own background
          // is still on-screen until the route swap so the transition
          // doesn't look ungated.
          setDifficultyOpen(false);
          setDifficultyError(null);
          openShop();
        }}
        walletCoins={wallet?.coins ?? 0}
        playerLevel={progression.level}
        busyId={enteringRoomId}
        matchmaking={matchmaking ?? undefined}
        onCancelMatchmaking={handleCancelMatchmaking}
      />
      {difficultyError && difficultyOpen ? (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[60] -translate-x-1/2 rounded-lg border border-rose-700/60 bg-gradient-to-b from-rose-100 to-rose-300 px-4 py-2 font-bold text-rose-950 shadow-2xl">
          {difficultyError}
        </div>
      ) : null}

      {/* Flying coin / gem tokens rendered above everything else. */}
      {rewardFlights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}

      {/* First-run onboarding tour — only once the lobby is fully painted
          (balances loaded, board rendered) so the spotlight never lands on a
          skeleton. Gated to brand-new players via profiles.tutorial_completed_at. */}
      {lobbyReady && tourPending ? <OnboardingTour onDone={handleTourDone} /> : null}
    </main>
  );
}
