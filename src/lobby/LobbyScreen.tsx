import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AILevel } from '../ai';
import { useAuth } from '../lib/auth';
import { useNavigationOverlay } from '../lib/navigationOverlay';
import { createOnlineMatch, enterRoom } from '../lib/persistence';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useImagePreloader } from '../lib/useImagePreloader';
import { BoardLockTooltip } from './BoardLockTooltip';
import { BoardPurchaseModal } from './BoardPurchaseModal';
import { DailyBonusModal } from './DailyBonusModal';
import { DifficultyModal, type DifficultySelection } from './DifficultyModal';
import { LobbyActionCard } from './LobbyActionCard';
import { LobbyBoardCarousel } from './LobbyBoardCarousel';
import { LobbyBottomNav } from './LobbyBottomNav';
import { LobbySideOffers } from './LobbySideOffers';
import { LobbyTopBar } from './LobbyTopBar';
import type { LobbyBoard, LobbyBoardId } from './lobbyData';
import { RewardFlight, type RewardFlightSpec, type FlightCurrency } from './RewardFlight';
import { useDailyBonus } from './useDailyBonus';
import { useLobbyBoards } from './useLobbyBoards';
import { computeBoardState, useUserBoardInventory } from './useUserBoardInventory';

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

type OpponentChoice = 'hotseat' | AILevel;

function LobbyBackgroundLayer({
  board,
  state,
}: {
  readonly board: LobbyBoard;
  readonly state: 'entering' | 'leaving';
}) {
  return (
    <div
      className={`lobby-background-layer fixed inset-0 ${
        state === 'leaving'
          ? 'lobby-background-layer--leaving'
          : 'lobby-background-layer--entering'
      }`}
      aria-hidden="true"
    >
      <img
        src={board.background}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0" style={{ background: board.backgroundTone }} />
    </div>
  );
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const { show: showOverlay, hide: hideOverlay } = useNavigationOverlay();
  const { profile, user, wallet, progression, isGuest, linkGoogleIdentity, refreshWallet } = useAuth();
  const { boards, isLoading: boardsLoading } = useLobbyBoards();
  const { ownedIds, refetch: refetchInventory } = useUserBoardInventory();
  const [selectedBoardId, setSelectedBoardId] = useState<LobbyBoardId>('');
  const [creatingOnline, setCreatingOnline] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [lockedTooltipFor, setLockedTooltipFor] = useState<LobbyBoard | null>(null);
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
  const [dailyBonusOpen, setDailyBonusOpen] = useState(false);
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
    // Capture the source element BEFORE the modal re-renders into its
    // claimed state (which removes the gem icon).
    const sourceEl = document.querySelector('[data-fly-source="gems"]');

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
    if (sourceEl) {
      if (reward.gems > 0) spawnFlights('gems', sourceEl, 6);
      if (reward.coins > 0) spawnFlights('coins', sourceEl, 6);
    }

    // Refresh streak state (so canClaim flips to false) and wallet (so
    // the top-bar counter ticks up around the time the flights land).
    dailyBonus.refetch();
    window.setTimeout(() => {
      void refreshWallet();
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
    if (!user || !dailyBonus.canClaim || dailyBonus.isLoading) return;
    if (dailyBonus.configs.length === 0) return;
    autoOpenedDailyBonusRef.current = true;
    setDailyBonusOpen(true);
  }, [user, dailyBonus.canClaim, dailyBonus.isLoading, dailyBonus.configs.length]);
  const effectiveSelectedBoardId = boards.some((board) => board.id === selectedBoardId)
    ? selectedBoardId
    : (boards[0]?.id ?? '');
  // selectedBoard may be undefined briefly before useLobbyBoards's DB
  // fetch resolves (or if no boards are configured in the back office).
  // All downstream code now treats it as optional.
  const selectedBoard = boards.find((board) => board.id === effectiveSelectedBoardId) ?? boards[0];
  const previousBoardRef = useRef<LobbyBoard | null>(selectedBoard ?? null);
  const [fadingBoard, setFadingBoard] = useState<LobbyBoard | null>(null);

  useEffect(() => {
    if (!selectedBoard) return;
    const previousBoard = previousBoardRef.current;
    if (previousBoard && previousBoard.id === selectedBoard.id) return;

    if (previousBoard) setFadingBoard(previousBoard);
    previousBoardRef.current = selectedBoard;

    const clearPrevious = window.setTimeout(() => setFadingBoard(null), 560);
    return () => window.clearTimeout(clearPrevious);
  }, [selectedBoard]);

  const startMatch = (opponent: OpponentChoice, target = 1) => {
    if (selectedBoard) {
      const state = boardStateOf(selectedBoard);
      if (state === 'level-locked') {
        setLockedTooltipFor(selectedBoard);
        return;
      }
      if (state === 'purchasable') {
        setPurchaseError(null);
        setPurchaseTarget(selectedBoard);
        return;
      }
    }
    const params = new URLSearchParams();
    params.set('opp', opponent);
    params.set('target', String(target));
    params.set('board', effectiveSelectedBoardId);
    // Put the loader up before the route changes so the lobby never
    // flashes between unmount and the gameplay's own preload gate.
    showOverlay();
    navigate(`/hotseat?${params.toString()}`);
  };

  /**
   * Called when the player picks a difficulty in the modal. The RPC
   * does all the heavy lifting (validate room, debit coins, create the
   * match row tagged with table_config_id) and we just route into the
   * new gameplay screen with the per-room turn timer pre-baked into the
   * URL. v1: ai-medium opponent for every difficulty room. Online
   * matchmaking through difficulties comes once the opponent-side
   * payment story lands.
   */
  const handleDifficultySelect = async (selection: DifficultySelection) => {
    if (enteringRoomId !== null) return;
    if (!user) {
      setDifficultyError('Sign in to enter a room.');
      return;
    }
    if (selectedBoard) {
      const state = boardStateOf(selectedBoard);
      if (state !== 'owned' && state !== 'free-unlock') {
        // Defensive: PLAY button shouldn't surface on locked or
        // gem-priced boards — LobbyBoardCarousel gates on the same
        // state — but we don't trust client state alone. If something
        // stale slips through, refuse and toast.
        setDifficultyError('Unlock this board before entering a room.');
        return;
      }
    }

    setEnteringRoomId(selection.tableConfigId);
    setDifficultyError(null);
    try {
      const result = await enterRoom({
        tableConfigId: selection.tableConfigId,
        matchMode: 'ai-medium',
      });
      // Wallet was debited server-side; pull the new balance so the
      // top-bar coins pill reflects the deduction before the route
      // change settles.
      void refreshWallet();
      const params = new URLSearchParams();
      params.set('opp', 'medium');
      params.set('target', String(result.target));
      params.set('board', effectiveSelectedBoardId);
      params.set('matchId', result.matchId);
      params.set('turn', String(result.turnSeconds));
      showOverlay();
      setDifficultyOpen(false);
      navigate(`/hotseat?${params.toString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('insufficient_coins')) {
        setDifficultyError('Not enough coins for this room.');
      } else if (msg.includes('level_too_low')) {
        setDifficultyError(`You haven't reached the required level for this room.`);
      } else if (msg.includes('room_disabled')) {
        setDifficultyError('This room is temporarily unavailable.');
      } else {
        setDifficultyError('Could not enter the room. Try again.');
      }
    } finally {
      setEnteringRoomId(null);
    }
  };

  const startOnline = async () => {
    if (!isSupabaseConfigured) {
      showOverlay();
      navigate('/lobby');
      return;
    }
    if (!user || creatingOnline) return;
    setCreatingOnline(true);
    setOnlineError(null);
    try {
      const { matchId } = await createOnlineMatch({ ownerId: user.id, target: 1 });
      showOverlay();
      navigate(`/play/${matchId}?board=${effectiveSelectedBoardId}`);
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingOnline(false);
    }
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

  // Note: no early-return loading gate here. The full lobby JSX renders
  // behind the route-spanning overlay so any internal layout work
  // settles while the loader is up — the overlay fades on lobbyReady to
  // reveal a stable, fully painted view.

  return (
    <main className="lobby-screen relative min-h-dvh overflow-x-hidden bg-[#071120] text-white">
      {fadingBoard ? (
        <LobbyBackgroundLayer key={`leaving-${fadingBoard.id}`} board={fadingBoard} state="leaving" />
      ) : null}
      {selectedBoard ? (
        <LobbyBackgroundLayer
          key={`entering-${selectedBoard.id}`}
          board={selectedBoard}
          state="entering"
        />
      ) : null}

      <div className="lobby-shell relative z-10 flex min-h-dvh flex-col px-4 pb-0 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-9">
        <LobbyTopBar
          profile={profile}
          wallet={wallet}
          progression={progression}
          isGuest={isGuest}
          onLinkGoogle={() => linkGoogleIdentity({ redirectTo: `${window.location.origin}/auth/callback?next=/` })}
        />

        <div className="lobby-main-grid grid flex-1 items-center gap-4 py-3 xl:grid-cols-[17rem_minmax(30rem,1fr)_19rem] xl:gap-6 2xl:grid-cols-[19rem_minmax(34rem,1fr)_22rem]">
          <LobbySideOffers
            onOfferClick={(offerId) => {
              if (offerId === 'daily' && dailyBonus.canClaim) openDailyBonus();
              else if (offerId === 'coins') navigate('/shop');
            }}
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
            />
          </div>

          <aside className="lobby-action-stack grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <LobbyActionCard
              title={creatingOnline ? 'Creating' : 'Play Online'}
              subtitle="Challenge players around the world"
              tone="blue"
              iconSrc="/lobby/icons/online-players.webp"
              onClick={startOnline}
              disabled={creatingOnline || (isSupabaseConfigured && !user)}
            />
            <LobbyActionCard
              title="Play Friends"
              subtitle="Two players on this device"
              tone="green"
              compactIcon="2"
              onClick={() => startMatch('hotseat')}
            />
            <LobbyActionCard
              title="Tournaments"
              subtitle="Warm up against Bailey"
              tone="purple"
              iconSrc="/lobby/icons/trophy.webp"
              onClick={() => startMatch('medium')}
            />
            {onlineError ? (
              <div className="rounded-md border border-rose-300/30 bg-rose-950/55 px-3 py-2 text-xs text-rose-100 sm:col-span-3 xl:col-span-1">
                {onlineError}
              </div>
            ) : null}
          </aside>
        </div>

        <LobbyBottomNav />
      </div>

      {lockedTooltipFor ? (
        <BoardLockTooltip
          key={`tooltip-${lockedTooltipFor.id}`}
          requiredLevel={lockedTooltipFor.unlockLevel}
          onDismiss={() => setLockedTooltipFor(null)}
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

      {dailyBonusOpen ? (
        <DailyBonusModal
          configs={dailyBonus.configs}
          upcomingDay={dailyBonus.upcomingDay}
          canClaim={dailyBonus.canClaim}
          isClaiming={isClaimingDailyBonus}
          errorMessage={dailyBonusError}
          justClaimed={justClaimedBonus}
          onClaim={claimDailyBonus}
        />
      ) : null}

      <DifficultyModal
        open={difficultyOpen}
        onClose={() => {
          if (enteringRoomId !== null) return;
          setDifficultyOpen(false);
          setDifficultyError(null);
        }}
        onSelect={handleDifficultySelect}
        walletCoins={wallet?.coins ?? 0}
        playerLevel={profile?.level ?? 1}
        busyId={enteringRoomId}
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
    </main>
  );
}
