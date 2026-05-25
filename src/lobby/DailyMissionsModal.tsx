import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from './RewardFlight';
import {
  formatCountdown,
  nextResetMs,
  type Mission,
  type MissionsResult,
  type RewardItem,
  type ChestMilestone,
} from './useDailyMissions';

interface Props {
  readonly result: MissionsResult;
  readonly onClose: () => void;
}

/**
 * Daily Missions full-screen modal. Per the mockup:
 *   - Header: title + refresh-in-time countdown + close.
 *   - Mission Points strip with 4 chest milestone markers.
 *   - Daily missions list (3 Common+Rare + 1 Epic), each a card
 *     with rarity badge, title, subtitle, progress bar, reward
 *     icons, action button (Claim when complete / Go otherwise).
 *   - "Claim All" affordance when any mission is claimable.
 *   - Reroll button (1 free/day, then escalating gem ladder).
 *   - Weekly Challenge card (single mission, period=weekly).
 *   - Daily Streak strip (7-day chest progress).
 *
 * Phase 6 ships the structural pass — pixel-perfect mockup styling
 * (carnival gold frames, halo glows, reward-flight animations) is
 * a follow-up polish pass.
 */
export function DailyMissionsModal({ result, onClose }: Props) {
  const { state, isLoading, error, refetch } = result;
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null);
  const [claimingChestIdx, setClaimingChestIdx] = useState<number | null>(null);
  const [rerollingMissionId, setRerollingMissionId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Reward-flight animation state. Mirrors the WheelModal pattern:
  // capture the source button rect at claim-time, find the wallet
  // pill destination via [data-fly-target], spawn N tokens per
  // currency with a stagger so they trail behind each other.
  const [flights, setFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(0);

  const spawnFlights = (currency: FlightCurrency, count: number, srcEl: HTMLElement | null) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
    if (!target || !srcEl) return;
    const srcRect = srcEl.getBoundingClientRect();
    const dstRect = target.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX = dstRect.left + dstRect.width / 2;
    const endY = dstRect.top + dstRect.height / 2;
    const additions: RewardFlightSpec[] = [];
    for (let i = 0; i < count; i++) {
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (Math.random() - 0.5) * 30,
        startY: startY + (Math.random() - 0.5) * 30,
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 850,
      });
    }
    setFlights((prev) => [...prev, ...additions]);
  };
  const removeFlight = (id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  // Refresh "now" every minute so the header countdown ticks.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ESC closes when no async op is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !claimingMissionId && !claimingChestIdx && !rerollingMissionId) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, claimingMissionId, claimingChestIdx, rerollingMissionId]);

  const missionsList = state?.missions ?? [];
  const dailies = useMemo(
    () => missionsList.filter((m) => m.period === 'daily'),
    [missionsList],
  );
  // Up to 2 weekly missions render side-by-side in the middle column.
  // If only 1 exists, the second slot falls back to the streak panel
  // styled to match the ornate weekly-frame look.
  const weeklies = useMemo(
    () => missionsList.filter((m) => m.period === 'weekly').slice(0, 2),
    [missionsList],
  );
  const claimableCount = useMemo(
    () => dailies.filter((m) => m.completed_at && !m.claimed_at).length,
    [dailies],
  );

  // Scale-to-fit wrapper. The modal is authored at a fixed design size
  // (1300 × 720) and shrinks proportionally on smaller viewports so
  // mobile fits without scrolling. Mirrors the pattern Shop.tsx uses.
  const PANEL_DESIGN_W = 1300;
  const PANEL_DESIGN_H = 720;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(
        1,
        (w * 0.98) / PANEL_DESIGN_W,
        (h * 0.96) / PANEL_DESIGN_H,
      );
      setScale(s);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const countdownMs = useMemo(() => {
    // Compute against `now` so it ticks; nextResetMs reads Date.now() once.
    void now;
    return nextResetMs(state);
  }, [state, now]);

  const handleClaim = async (missionId: string, srcEl: HTMLElement | null) => {
    setClaimingMissionId(missionId);
    setActionError(null);
    // Look up the mission's reward bundle BEFORE the RPC fires, so we
    // know which currencies to fly + how many tokens of each. The
    // count scales with amount (8 max per currency to keep the
    // animation tight).
    const mission = missionsList.find((m) => m.id === missionId);
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_mission', { p_mission_id: missionId });
      if (rpcErr) {
        setActionError(extractErrorMessage(rpcErr));
        return;
      }
      // Spawn flights — credited_* values from the RPC response are
      // authoritative (covers the case where the operator changed
      // rewards mid-claim).
      const credited = data as { credited_coins?: number; credited_gems?: number; credited_xp?: number };
      if (credited?.credited_coins && credited.credited_coins > 0) {
        spawnFlights('coins', Math.min(8, Math.max(3, Math.ceil(credited.credited_coins / 75))), srcEl);
      }
      if (credited?.credited_gems && credited.credited_gems > 0) {
        spawnFlights('gems', Math.min(6, Math.max(2, credited.credited_gems)), srcEl);
      }
      if (credited?.credited_xp && credited.credited_xp > 0) {
        spawnFlights('xp', Math.min(5, Math.max(2, credited.credited_xp)), srcEl);
      }
      // Fallback if the RPC didn't return credited_* (older clients):
      // derive from the mission's rewards bundle.
      if (!credited?.credited_coins && !credited?.credited_gems && !credited?.credited_xp && mission) {
        for (const r of mission.rewards) {
          if (r.reward_kind !== 'currency' || !r.currency_code) continue;
          if (r.currency_code === 'coins') spawnFlights('coins', Math.min(8, Math.max(3, Math.ceil(r.amount / 75))), srcEl);
          else if (r.currency_code === 'gems') spawnFlights('gems', Math.min(6, Math.max(2, r.amount)), srcEl);
          else if (r.currency_code === 'xp') spawnFlights('xp', Math.min(5, Math.max(2, r.amount)), srcEl);
        }
      }
      refetch();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setClaimingMissionId(null);
    }
  };

  const handleClaimAll = async () => {
    const claimables = dailies.filter((m) => m.completed_at && !m.claimed_at);
    for (const m of claimables) {
      // For the batch claim, use the Claim All button as the visual
      // origin for every flight — simpler than tracking per-card
      // refs through the batch.
      const claimAllBtn = document.querySelector<HTMLElement>('[data-claim-all-btn]');
      await handleClaim(m.id, claimAllBtn);
    }
  };

  const handleReroll = async (missionId: string) => {
    setRerollingMissionId(missionId);
    setActionError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('reroll_mission', { p_mission_id: missionId });
      if (rpcErr) setActionError(extractErrorMessage(rpcErr));
      else refetch();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setRerollingMissionId(null);
    }
  };

  const handleClaimChest = async (milestoneIndex: number) => {
    setClaimingChestIdx(milestoneIndex);
    setActionError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('claim_chest', { p_milestone_index: milestoneIndex });
      if (rpcErr) setActionError(extractErrorMessage(rpcErr));
      else refetch();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setClaimingChestIdx(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2">
      {/* Scale-to-fit wrapper. The inner panel is authored at its
          natural design size (1300 × 720); on any smaller viewport,
          we shrink the whole panel by min(98vw/W, 96vh/H) so the
          entire modal is always visible at once without scrolling. */}
      <div className="origin-center" style={{ transform: `scale(${scale})` }}>
        <div
          className="relative rounded-3xl bg-gradient-to-b from-[#162C73] to-[#09051D] p-5 shadow-[0_25px_60px_rgba(0,0,0,0.7)] ring-2 ring-[#D89A2B]/80"
          style={{ width: `${PANEL_DESIGN_W}px`, height: `${PANEL_DESIGN_H}px` }}
        >
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-3 font-display text-3xl font-black tracking-wider text-[#FFD25C]">
                <span>DAILY MISSIONS</span>
                <img
                  src="/lobby/missions/dice-icon.webp"
                  alt=""
                  draggable={false}
                  className="h-10 w-10 object-contain"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              </h2>
              <p className="mt-0.5 text-sm text-[#C6B7D8]">
                Complete missions. Earn points. Claim epic rewards!
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-[#1D2460]/80 px-3 py-1.5 text-right ring-1 ring-[#D89A2B]/40">
                <div className="text-[10px] uppercase tracking-wider text-[#FFD25C]/80">
                  Refreshes in
                </div>
                <div className="font-mono text-sm font-bold text-[#FFF6E9]">
                  {formatCountdown(countdownMs)}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-[#FF6488] to-[#D91E47] text-xl font-bold text-white shadow-lg ring-2 ring-[#FF6488]/60 transition hover:brightness-110"
              >
                ×
              </button>
            </div>
          </div>

          {isLoading && !state ? (
            <div className="py-12 text-center text-amber-200/70">Loading missions…</div>
          ) : error ? (
            <div className="rounded-lg bg-rose-950/60 px-4 py-3 text-rose-200">{error}</div>
          ) : !state ? (
            <div className="py-12 text-center text-amber-200/70">No missions today.</div>
          ) : (
            <>
              {/* Mission Points + Chest Track — stays full-width above
                  the 3-column body. */}
              <ChestTrackStrip
                mpEarned={state.weekly_pass.mp_earned}
                milestones={state.chest_milestones}
                chestsClaimed={state.weekly_pass.chests_claimed}
                claimingIdx={claimingChestIdx}
                onClaimChest={handleClaimChest}
              />

              {/* Body: 60/40 split for daily + weekly, then a
                  full-width REROLL pill underneath (per the new
                  mockup — reroll lives at the bottom now, not
                  inside the right column). */}
              <div className="grid grid-cols-[3fr_2fr] gap-4">
                {/* Left column — daily missions */}
                <div className="flex flex-col">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-display text-base font-bold tracking-wide text-[#FFF6E9]">
                      DAILY MISSIONS
                    </h3>
                    <button
                      type="button"
                      data-claim-all-btn
                      disabled={claimableCount === 0 || claimingMissionId !== null}
                      onClick={handleClaimAll}
                      className="rounded-md bg-gradient-to-b from-[#F3C55B] to-[#B67816] px-4 py-1 text-xs font-bold text-[#3a1f08] shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {claimableCount > 0 ? `CLAIM ALL (${claimableCount})` : 'CLAIM ALL'}
                    </button>
                  </div>

                  <div className="flex flex-1 flex-col gap-2">
                    {dailies.map((m) => (
                      <MissionCard
                        key={m.id}
                        mission={m}
                        isClaiming={claimingMissionId === m.id}
                        isRerolling={rerollingMissionId === m.id}
                        onClaim={(el) => handleClaim(m.id, el)}
                        onGo={onClose}
                      />
                    ))}
                    {dailies.length === 0 && (
                      <div className="rounded-lg bg-[#1D2460]/60 py-6 text-center text-sm text-[#C6B7D8]">
                        No active missions. Come back at midnight UTC.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column: 2 weekly cards side by side, full
                    height of the column. */}
                <div className="grid grid-cols-2 gap-3">
                  {weeklies[0] ? (
                    <WeeklyChallengeCard
                      mission={weeklies[0]}
                      isClaiming={claimingMissionId === weeklies[0].id}
                      onClaim={(el) => handleClaim(weeklies[0]!.id, el)}
                      onGo={onClose}
                    />
                  ) : (
                    <StreakPanel
                      streak={state.streak}
                      streakChestRewards={state.streak_chest_rewards}
                    />
                  )}
                  {weeklies[1] ? (
                    <WeeklyChallengeCard
                      mission={weeklies[1]}
                      isClaiming={claimingMissionId === weeklies[1].id}
                      onClaim={(el) => handleClaim(weeklies[1]!.id, el)}
                      onGo={onClose}
                    />
                  ) : (
                    <StreakPanel
                      streak={state.streak}
                      streakChestRewards={state.streak_chest_rewards}
                    />
                  )}
                </div>
              </div>

              {/* REROLL — full-width green pill at the bottom of
                  the panel per the latest mockup. */}
              <div className="mt-3">
                <RerollPanel
                  rerollState={state.reroll}
                  rerollingId={rerollingMissionId}
                  dailies={dailies}
                  onReroll={handleReroll}
                />
              </div>

              {actionError && (
                <div className="mt-3 rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
                  {actionError}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Reward-flight tokens render OUTSIDE the modal frame at
          z-[60] so they travel cleanly over the lobby top-bar to
          land on the wallet pill ([data-fly-target="coins"|"gems"|"xp"]).
          Same pattern WheelModal uses. */}
      {flights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}
    </div>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function ChestTrackStrip({
  mpEarned,
  milestones,
  chestsClaimed,
  claimingIdx,
  onClaimChest,
}: {
  readonly mpEarned: number;
  readonly milestones: readonly ChestMilestone[];
  readonly chestsClaimed: readonly number[];
  readonly claimingIdx: number | null;
  readonly onClaimChest: (idx: number) => void;
}) {
  const maxThreshold = Math.max(...milestones.map((m) => m.threshold_mp), 100);
  const progressPct = Math.min(100, (mpEarned / maxThreshold) * 100);

  // Chests grow progressively bigger from left to right, reinforcing
  // the milestone progression visually. Values are h-* tailwind sizes.
  const chestSizes = ['h-12', 'h-14', 'h-16', 'h-20'];

  return (
    <div className="mb-3 rounded-2xl bg-gradient-to-b from-[#1D2460] to-[#162C73] p-4 ring-1 ring-[#D89A2B]/60">
      {/* Top row: MP value (lightning-bolt mark) + the chest track */}
      <div className="flex items-end gap-4 sm:gap-6">
        {/* Lightning + MP count, left-anchored like the mockup */}
        <div className="flex shrink-0 flex-col items-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-b from-[#FFD25C] to-[#B67816] text-2xl text-[#3a1f08] shadow-md ring-2 ring-[#FFD25C]/70">
            ⚡
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-display text-2xl font-black text-[#FFF6E9]">{mpEarned}</span>
            <span className="text-xs text-[#C6B7D8]">/ {maxThreshold}</span>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-[#FFD25C]/80">
            Mission Points
          </span>
        </div>

        {/* Chest track — 4-equal-column GRID so each column's centre
            anchors the chest, its threshold number, AND its status
            dot. The previous flex+justify-between layout left chests
            edge-aligned (small chest pulled to slot-left, big chest to
            slot-right) and made the dots underneath visibly misaligned
            with the chests above. Grid eliminates that. */}
        <div className="relative flex-1">
          {/* Progress line — absolute, runs across the back of the
              chest row so it sits behind the chests visually. */}
          <div className="absolute left-0 right-0 top-[42%] h-1 -translate-y-1/2 rounded-full bg-[#1B1635]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FFD25C] to-[#F3C55B] shadow-[0_0_8px_rgba(255,210,92,0.55)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* 4-col grid for chests */}
          <div className="relative grid grid-cols-4 items-end">
            {milestones.map((m, i) => {
              const claimed = chestsClaimed.includes(m.milestone_index);
              const unlocked = mpEarned >= m.threshold_mp;
              const ready = unlocked && !claimed;
              const sizeClass = chestSizes[i] ?? 'h-14';
              return (
                <button
                  key={`chest-${m.milestone_index}`}
                  type="button"
                  disabled={!ready || claimingIdx !== null}
                  onClick={() => onClaimChest(m.milestone_index)}
                  className={`flex justify-center transition ${
                    ready ? 'animate-pulse' : ''
                  } ${!unlocked ? 'opacity-50 grayscale' : ''}`}
                  aria-label={`${m.display_name} chest at ${m.threshold_mp} MP`}
                >
                  <img
                    src={`/lobby/missions/chest-${m.milestone_index}.webp`}
                    alt=""
                    draggable={false}
                    className={`${sizeClass} object-contain drop-shadow-lg`}
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                  />
                </button>
              );
            })}
          </div>

          {/* Threshold numbers + dots — matching 4-col grid so each
              label/dot is centred under its chest column. */}
          <div className="mt-2 grid grid-cols-4">
            {milestones.map((m) => {
              const claimed = chestsClaimed.includes(m.milestone_index);
              const unlocked = mpEarned >= m.threshold_mp;
              const ready = unlocked && !claimed;
              return (
                <div
                  key={`thr-${m.milestone_index}`}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="font-display text-xs font-bold text-[#FFF6E9]">
                    {m.threshold_mp}
                  </span>
                  <span
                    className={`grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] ring-1 ${
                      claimed
                        ? 'bg-emerald-500 text-white ring-emerald-300'
                        : ready
                          ? 'bg-[#FFD25C] text-[#3a1f08] ring-[#FFF6E9]/60'
                          : 'bg-[#1B1635] text-transparent ring-[#D89A2B]/40'
                    }`}
                  >
                    {claimed ? '✓' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MissionCard({
  mission,
  isClaiming,
  isRerolling,
  onClaim,
  onGo,
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly isRerolling: boolean;
  readonly onClaim: (sourceEl: HTMLElement | null) => void;
  /** Called when the GO button is clicked on an incomplete mission.
   *  Closes the missions modal so the player can go play. */
  readonly onGo?: () => void;
  readonly variant?: 'daily' | 'weekly';
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);

  // Rarity-driven palette. Source: design spec
  //   Common  card bg #35296A → #19183B, border glow #3BC8FF, fill #7DFF4D
  //   Rare    card bg #2C2E86,           border glow #2AAEFF, fill #35C8FF
  //   Epic    card bg #4A216F,           border glow #D447FF, fill #C85CFF
  const cardBgByRarity: Record<string, string> = {
    common: 'bg-gradient-to-b from-[#35296A] to-[#19183B]',
    rare:   'bg-gradient-to-b from-[#2C2E86] to-[#19183B]',
    epic:   'bg-gradient-to-b from-[#4A216F] to-[#19183B]',
  };
  const ringByRarity: Record<string, string> = {
    common: 'ring-[#3BC8FF]/60',
    rare:   'ring-[#2AAEFF]/60',
    epic:   'ring-[#D447FF]/60',
  };
  // Recommended outer glow per spec.
  const glowByRarity: Record<string, string> = {
    common: 'shadow-[0_0_14px_rgba(60,190,255,0.5)]',
    rare:   'shadow-[0_0_14px_rgba(60,190,255,0.5)]',
    epic:   'shadow-[0_0_14px_rgba(210,80,255,0.5)]',
  };
  const progressFillByRarity: Record<string, string> = {
    common: 'bg-[#7DFF4D] shadow-[0_0_12px_rgba(120,255,120,0.55)]',
    rare:   'bg-[#35C8FF] shadow-[0_0_14px_rgba(60,190,255,0.55)]',
    epic:   'bg-[#C85CFF] shadow-[0_0_14px_rgba(210,80,255,0.55)]',
  };

  // The badge PNG (operator-provided art) bakes the rarity tier
  // and a generic dice/trophy icon into a single artwork.
  const badgeSrc = `/lobby/missions/badge-${mission.rarity}.webp`;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${
        cardBgByRarity[mission.rarity] ?? cardBgByRarity.common
      } ${ringByRarity[mission.rarity] ?? ringByRarity.common} ${
        glowByRarity[mission.rarity] ?? glowByRarity.common
      }`}
    >
      {/* Rarity badge (icon + rarity word baked into the artwork) */}
      <div className="shrink-0">
        <img
          src={badgeSrc}
          alt={`${mission.rarity} mission`}
          draggable={false}
          className="h-16 w-16 object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      </div>

      {/* Title, subtitle, progress */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-display text-base font-bold text-[#FFF6E9]">
            {mission.title}
          </div>
          {mission.mission_points > 0 && (
            <span className="rounded-md bg-[#1D2460]/80 px-1.5 py-0.5 text-[10px] font-bold text-[#FFD25C] ring-1 ring-[#D89A2B]/40">
              +{mission.mission_points} MP
            </span>
          )}
        </div>
        {mission.subtitle && (
          <div className="truncate text-xs text-[#C6B7D8]">{mission.subtitle}</div>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#17122D]">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                progressFillByRarity[mission.rarity] ?? progressFillByRarity.common
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-[#FFF6E9]">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>
      </div>

      {/* Rewards */}
      <RewardStack rewards={mission.rewards} />

      {/* Action button.
          GO    — sky-blue gradient per spec, closes the modal.
          CLAIM — emerald gradient, fires the claim RPC + flight.
          CLAIMED — disabled darker emerald. */}
      <button
        ref={btnRef}
        type="button"
        disabled={isClaimed || isClaiming || isRerolling}
        onClick={() => {
          if (isClaimed) return;
          if (isCompleted) onClaim(btnRef.current);
          else onGo?.();
        }}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-md transition ${
          isClaimed
            ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 opacity-90'
            : isCompleted
              ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 hover:brightness-110'
              : 'bg-gradient-to-b from-[#4ED2FF] to-[#0088FF] shadow-[0_0_12px_rgba(115,216,255,0.45)] hover:brightness-110'
        }`}
      >
        {isClaimed ? 'CLAIMED' : isCompleted ? (isClaiming ? '…' : 'CLAIM') : 'GO'}
      </button>
    </div>
  );
}

function WeeklyChallengeCard({
  mission,
  isClaiming,
  onClaim,
  onGo,
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly onClaim: (sourceEl: HTMLElement | null) => void;
  readonly onGo?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);

  // CSS-only weekly card: purple gradient body, gold rim, inner
  // fog from a radial overlay, soft purple outer glow. Operator
  // said they'll layer an ornate art frame on top later — this
  // box just needs to read clearly and contain its content.
  return (
    <div
      className="relative flex h-full w-full flex-col rounded-2xl bg-gradient-to-b from-[#5C1B8A] to-[#34105D] p-3 ring-2 ring-[#E2A93B]/80 shadow-[0_0_24px_rgba(110,27,206,0.45)]"
    >
      {/* Inner fog — radial highlight at the top centre for depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(92,27,138,0.55) 0%, transparent 60%)',
        }}
      />

      {/* Title plate — gold ribbon banner at the top. */}
      <div className="relative z-[1] mb-1 self-center rounded-md bg-gradient-to-b from-[#E2A93B] to-[#B67816] px-3 py-0.5 font-display text-[11px] font-black uppercase tracking-wider text-[#3a1f08] shadow ring-1 ring-[#FFD25C]/70">
        Weekly Challenge
      </div>

      {/* Body content. justify-between distributes title→bar→rewards→btn
        * across the available height; overflow-hidden + line-clamp on
        * title/subtitle prevents long copy from breaking the layout. */}
      <div className="relative z-[1] flex flex-1 flex-col items-center justify-between overflow-hidden text-center">
        <div className="w-full">
          <h3 className="line-clamp-2 font-display text-sm font-bold leading-tight text-[#FFF6E9]">
            {mission.title}
          </h3>
          {mission.subtitle && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-[#C6B7D8]">
              {mission.subtitle}
            </p>
          )}
        </div>

        <div className="flex w-full items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1A1028]">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isCompleted
                  ? 'bg-emerald-400 shadow-[0_0_12px_rgba(120,255,120,0.45)]'
                  : 'bg-[#B54CFF] shadow-[0_0_14px_rgba(210,80,255,0.5)]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] font-bold text-[#FFF6E9]">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {mission.rewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center">
              <RewardIcon reward={r} />
              <span className="text-[10px] font-bold text-[#FFF6E9]">
                +{formatAmount(r.amount)}
              </span>
            </div>
          ))}
        </div>

        <button
          ref={btnRef}
          type="button"
          disabled={isClaimed || isClaiming}
          onClick={() => {
            if (isClaimed) return;
            if (isCompleted) onClaim(btnRef.current);
            else onGo?.();
          }}
          className={`rounded-lg px-5 py-1 text-xs font-bold text-white shadow-md transition ${
            isClaimed
              ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 opacity-90'
              : isCompleted
                ? 'bg-gradient-to-b from-emerald-400 to-emerald-600'
                : 'bg-gradient-to-b from-[#4ED2FF] to-[#0088FF] shadow-[0_0_12px_rgba(115,216,255,0.45)] hover:brightness-110'
          }`}
        >
          {isClaimed ? 'CLAIMED' : isCompleted ? (isClaiming ? '…' : 'CLAIM') : 'GO'}
        </button>
      </div>
    </div>
  );
}

function RewardStack({ rewards }: { readonly rewards: readonly RewardItem[] }) {
  if (rewards.length === 0) return null;
  // Render rewards with a thin vertical divider between each pair —
  // the mockup uses visual separation rather than just gap so a
  // mission with 3 rewards reads as "+250 | +20 | +10" not a blob.
  return (
    <div className="hidden shrink-0 items-center gap-2 sm:flex">
      {rewards.flatMap((r, i) => {
        const item = (
          <div key={`r-${i}`} className="flex flex-col items-center">
            <RewardIcon reward={r} />
            <span className="text-[10px] font-bold text-amber-100">+{formatAmount(r.amount)}</span>
          </div>
        );
        return i === 0
          ? [item]
          : [<div key={`sep-${i}`} className="h-9 w-px bg-amber-500/30" />, item];
      })}
    </div>
  );
}

function RewardIcon({ reward }: { readonly reward: RewardItem }) {
  if (reward.reward_kind === 'currency') {
    const iconMap: Record<string, string> = {
      coins: '/lobby/icons/gold-coin.webp',
      gems: '/lobby/icons/gem.webp',
    };
    const src = iconMap[reward.currency_code ?? ''];
    if (reward.currency_code === 'xp') {
      return (
        <div className="grid h-7 w-7 place-items-center rounded bg-gradient-to-b from-violet-400 to-violet-700 text-[9px] font-black text-white">
          XP
        </div>
      );
    }
    if (src) return <img src={src} alt="" className="h-7 w-7 object-contain" draggable={false} />;
  }
  return <div className="grid h-7 w-7 place-items-center rounded bg-stone-700 text-[9px] text-white">?</div>;
}

function formatAmount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

function RerollPanel({
  rerollState,
  rerollingId,
  dailies,
  onReroll,
}: {
  readonly rerollState: { rerolls_today: number; daily_cap: number; next_cost: number | null };
  readonly rerollingId: string | null;
  readonly dailies: readonly Mission[];
  readonly onReroll: (missionId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rerollable = dailies.filter((m) => !m.claimed_at && !m.completed_at);
  const canReroll = rerollState.rerolls_today < rerollState.daily_cap && rerollable.length > 0;
  const isFree = rerollState.next_cost === 0;

  // Full-width green pill at the bottom of the modal. Single horizontal
  // row: glyph + REROLL title + free/cost copy on the left, 4 mission
  // radios in the middle, x/y counter + REROLL action button on the
  // right. Colours per the design spec (#1C4A13 → #10270D body,
  // #64FF57 border, #49D61B button, #1D8300 shadow).
  return (
    <div className="flex items-center gap-4 rounded-xl bg-gradient-to-b from-[#1C4A13] to-[#10270D] px-4 py-2.5 ring-1 ring-[#64FF57]/60 shadow-[0_0_18px_rgba(100,255,87,0.25)]">
      {/* Left: glyph + REROLL header + small free/cost copy */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-[#10270D] text-base text-[#64FF57] ring-1 ring-[#64FF57]/50">
          ⟳
        </span>
        <div className="leading-tight">
          <div className="font-display text-sm font-bold tracking-wide text-[#FFF6E9]">
            REROLL
          </div>
          <div className="text-[10px] text-[#C6B7D8]">
            {rerollState.next_cost === null
              ? 'Out of rerolls today.'
              : isFree
                ? 'First reroll is free.'
                : `Next reroll: ${rerollState.next_cost} gems.`}
          </div>
        </div>
      </div>

      {/* Middle: 4 mission radios inline. Always rendered so the
        * pill height stays consistent — disabled (read-only) when
        * the player can't reroll. */}
      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {rerollable.length > 0 ? (
          rerollable.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-[#FFF6E9]"
            >
              <input
                type="radio"
                name="reroll-target"
                value={m.id}
                checked={selectedId === m.id}
                onChange={() => setSelectedId(m.id)}
                className="accent-[#49D61B]"
              />
              <span>{m.title}</span>
            </label>
          ))
        ) : (
          <span className="text-xs text-[#C6B7D8]">No rerollable missions.</span>
        )}
      </div>

      {/* Right: counter + action button */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-xs font-bold text-[#FFF6E9]">
          {rerollState.rerolls_today} / {rerollState.daily_cap}
        </span>
        <button
          type="button"
          disabled={!canReroll || !selectedId || rerollingId !== null}
          onClick={() => selectedId && onReroll(selectedId)}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[#49D61B] to-[#1D8300] px-5 py-2 text-sm font-bold text-white shadow-[0_3px_0_#0a5200] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rerollingId ? (
            <span>Rerolling…</span>
          ) : isFree ? (
            <span>REROLL (FREE)</span>
          ) : (
            <>
              <span>REROLL ({rerollState.next_cost}</span>
              <img
                src="/lobby/icons/gem.webp"
                alt="gems"
                draggable={false}
                className="h-4 w-4 object-contain"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
              <span>)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function StreakPanel({
  streak,
  streakChestRewards,
}: {
  readonly streak: { current_streak_days: number; total_streak_chests_claimed: number };
  readonly streakChestRewards: readonly RewardItem[];
}) {
  const daysToChest = Math.max(0, 7 - (streak.current_streak_days % 7));
  const canClaim = streak.current_streak_days >= 7;

  const handleClaim = async () => {
    await supabase.rpc('claim_streak_chest');
  };

  // Same CSS-only box as WeeklyChallengeCard so the streak panel
  // matches the weekly card visually. Title plate reads "DAILY
  // STREAK" instead of "WEEKLY CHALLENGE".
  return (
    <div className="relative flex h-full w-full flex-col rounded-2xl bg-gradient-to-b from-[#5C1B8A] to-[#34105D] p-3 ring-2 ring-[#E2A93B]/80 shadow-[0_0_24px_rgba(110,27,206,0.45)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(92,27,138,0.55) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-[1] mb-1 self-center rounded-md bg-gradient-to-b from-[#E2A93B] to-[#B67816] px-3 py-0.5 font-display text-[11px] font-black uppercase tracking-wider text-[#3a1f08] shadow ring-1 ring-[#FFD25C]/70">
        Daily Streak
      </div>

      <div className="relative z-[1] flex flex-1 flex-col items-center justify-between overflow-hidden text-center">
        <div className="w-full">
          <div className="font-display text-sm font-bold leading-tight text-[#FFF6E9]">
            {streak.current_streak_days} day{streak.current_streak_days === 1 ? '' : 's'}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-[#C6B7D8]">
            Complete all daily missions for 7 days to earn the streak chest.
          </p>
        </div>

        <div className="flex w-full items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1A1028]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#B54CFF] shadow-[0_0_14px_rgba(210,80,255,0.5)]"
              style={{ width: `${((streak.current_streak_days % 7) / 7) * 100}%` }}
            />
          </div>
          <span className="font-mono text-[11px] font-bold text-[#FFF6E9]">
            {streak.current_streak_days % 7} / 7
          </span>
        </div>

        {streakChestRewards.length > 0 && (
          <div className="flex items-center justify-center gap-2">
            {streakChestRewards.map((r, i) => (
              <div key={i} className="flex flex-col items-center">
                <RewardIcon reward={r} />
                <span className="text-[10px] font-bold text-[#FFF6E9]">
                  +{formatAmount(r.amount)}
                </span>
              </div>
            ))}
          </div>
        )}

        {canClaim ? (
          <button
            type="button"
            onClick={handleClaim}
            className="rounded-lg bg-gradient-to-b from-[#F3C55B] to-[#B67816] px-5 py-1 text-xs font-bold text-[#3a1f08] shadow-md hover:brightness-110"
          >
            CLAIM STREAK CHEST
          </button>
        ) : (
          <p className="text-[11px] text-[#C6B7D8]">
            {daysToChest} day{daysToChest === 1 ? '' : 's'} to next chest
          </p>
        )}
      </div>
    </div>
  );
}
