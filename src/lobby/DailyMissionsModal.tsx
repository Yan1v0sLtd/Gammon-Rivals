import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from './RewardFlight';
import { CHESTS_ENABLED } from './lobbyData';
import { PlayButton } from '../components/PlayButton';
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

  // Refresh "now" every second so the header countdown ticks with seconds
  // visible. 1-second cadence is fine — setNow only triggers a re-render
  // of the header element via the countdownMs memo, and nothing else
  // depends on `now`.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
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

  // Scale-to-fit wrapper. Design size 1500 × 800 — wider + slightly
  // shorter than v1 so the modal uses more of the mobile-landscape
  // viewport (typically 932 × 430 → leaves no usable side margins).
  // The whole panel shrinks proportionally on smaller viewports.
  const PANEL_DESIGN_W = 1500;
  const PANEL_DESIGN_H = 800;
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
        {/* Panel is a FLEX COLUMN so the reroll pill (last child) can
          * mt-auto pin to the bottom and the body grid above takes
          * flex-1 of the remaining height. Previously the layout was
          * default-block so the reroll could be pushed past the
          * panel's bottom border when the body was tall. */}
        <div
          className="relative flex flex-col rounded-3xl bg-gradient-to-b from-[#162C73] to-[#09051D] p-4 shadow-[0_25px_60px_rgba(0,0,0,0.7)] ring-2 ring-[#D89A2B]/80"
          style={{ width: `${PANEL_DESIGN_W}px`, height: `${PANEL_DESIGN_H}px` }}
        >
          {/* Top row — circular dice badge + title block + chest
              progress + refresh/close all share a single horizontal
              line per the mockup. */}
          <div className="mb-3 flex shrink-0 items-center gap-3">
            {/* Circular dice badge — left of the title block */}
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 border-[#D89A2B] bg-gradient-to-b from-[#1D2460] to-[#09051D] shadow-[0_4px_8px_rgba(0,0,0,0.45)]">
              <img
                src="/lobby/missions/dice-icon.webp"
                alt=""
                draggable={false}
                className="h-12 w-12 object-contain"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            </div>

            {/* Title block — title + 2-line subtitle */}
            <div className="flex shrink-0 flex-col justify-center pr-1">
              <h2 className="font-display text-4xl font-black tracking-wider text-[#FFD25C] leading-none">
                DAILY MISSIONS
              </h2>
              <p className="mt-1 text-base leading-tight text-[#C6B7D8]" style={{ maxWidth: '14rem' }}>
                Complete missions. Earn points. Claim epic rewards!
              </p>
            </div>

            {/* Chest progress — fills the middle. Gated by CHESTS_ENABLED
                (lobbyData.ts): when the chest sub-feature is disabled we
                render an empty flex-1 spacer so the title block stays
                left and the refresh/close cluster stays right. Server
                still accrues mp_earned, so re-enabling shows accurate
                state with no backfill needed. */}
            {CHESTS_ENABLED && state ? (
              <ChestTrackStrip
                mpEarned={state.weekly_pass.mp_earned}
                milestones={state.chest_milestones}
                chestsClaimed={state.weekly_pass.chests_claimed}
                claimingIdx={claimingChestIdx}
                onClaimChest={handleClaimChest}
              />
            ) : (
              <div className="flex-1" />
            )}

            {/* Refresh chip stacked over the close button on the right */}
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="rounded-lg bg-[#1D2460]/80 px-3 py-1.5 text-right ring-1 ring-[#D89A2B]/40">
                <div className="text-xs uppercase tracking-wider text-[#FFD25C]/80">
                  Refreshes in
                </div>
                <div className="font-mono text-base font-bold text-[#FFF6E9]">
                  {formatCountdown(countdownMs)}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
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
              {/* Body: 60/40 split. Right column is now a vertical
                  stack of three panels: Daily Streak (top), Weekly
                  Challenge (middle), REROLL (bottom). */}
              <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-4">
                {/* Left column — daily missions */}
                <div className="flex min-h-0 flex-col overflow-hidden">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-2xl font-bold tracking-wide text-[#FFF6E9]">
                      DAILY MISSIONS
                    </h3>
                    <button
                      type="button"
                      data-claim-all-btn
                      disabled={claimableCount === 0 || claimingMissionId !== null}
                      onClick={handleClaimAll}
                      className="rounded-md bg-gradient-to-b from-[#F3C55B] to-[#B67816] px-5 py-2 text-base font-bold text-[#3a1f08] shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {claimableCount > 0 ? `CLAIM ALL (${claimableCount})` : 'CLAIM ALL'}
                    </button>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-px">
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

                {/* Right column — 3 panels stacked vertically.
                    Streak + Weekly are `shrink-0` so each is only as
                    tall as its content needs (≈30 % shorter than the
                    previous flex-1-stretched version). The reroll
                    pill uses `mt-auto` to anchor at the bottom of
                    the column so the empty space sits between the
                    upper panels and the reroll, not below it. */}
                <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
                  <div className="shrink-0">
                    <StreakPanel
                      streak={state.streak}
                      streakChestRewards={state.streak_chest_rewards}
                    />
                  </div>
                  {weeklies[0] && (
                    <div className="shrink-0">
                      <WeeklyChallengeCard
                        mission={weeklies[0]}
                        isClaiming={claimingMissionId === weeklies[0].id}
                        onClaim={(el) => handleClaim(weeklies[0]!.id, el)}
                        onGo={onClose}
                      />
                    </div>
                  )}
                  <div className="mt-auto shrink-0">
                    <RerollPanel
                      rerollState={state.reroll}
                      rerollingId={rerollingMissionId}
                      dailies={dailies}
                      onReroll={handleReroll}
                    />
                  </div>
                </div>
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
  // Trimmed one tier (was h-12-h-20) so the chest strip doesn't eat
  // 30 % of the panel; daily missions need that vertical room.
  const chestSizes = ['h-10', 'h-12', 'h-14', 'h-16'];

  return (
    <div className="flex flex-1 items-center gap-4 rounded-2xl bg-gradient-to-b from-[#1D2460] to-[#162C73] px-4 py-2 ring-1 ring-[#D89A2B]/60">
      {/* MP counter left-anchored — compact column with ⚡ + value */}
      <div className="flex shrink-0 flex-col items-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-[#FFD25C] to-[#B67816] text-xl text-[#3a1f08] shadow-md ring-2 ring-[#FFD25C]/70">
            ⚡
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-display text-2xl font-black text-[#FFF6E9]">{mpEarned}</span>
            <span className="text-sm text-[#C6B7D8]">/ {maxThreshold}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-[#FFD25C]/80">
            Mission Points
          </span>
        </div>

        {/* Chest track. Progress line is now ABSOLUTE-positioned
            BEHIND the chest row (mid-height), so the line visually
            passes through the chests as in the mockup — not stacked
            below them. Threshold + status-dot row sits underneath. */}
        <div className="relative flex-1">
          {/* Progress line — absolute, runs across the back of the
              chest row at mid-height. Sits behind chests via z-0. */}
          <div className="absolute left-0 right-0 top-[40%] z-0 h-1.5 -translate-y-1/2 rounded-full bg-[#1B1635]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FFD25C] to-[#F3C55B] shadow-[0_0_8px_rgba(255,210,92,0.55)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Chests — 4-col grid, on top of the progress line */}
          <div className="relative z-[1] grid grid-cols-4 items-end">
            {milestones.map((m, i) => {
              const claimed = chestsClaimed.includes(m.milestone_index);
              const unlocked = mpEarned >= m.threshold_mp;
              const ready = unlocked && !claimed;
              const sizeClass = chestSizes[i] ?? 'h-16';
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

          {/* Threshold + dot, 4-col grid matching the chest row */}
          <div className="mt-1.5 grid grid-cols-4">
            {milestones.map((m) => {
              const claimed = chestsClaimed.includes(m.milestone_index);
              const unlocked = mpEarned >= m.threshold_mp;
              const ready = unlocked && !claimed;
              return (
                <div
                  key={`thr-${m.milestone_index}`}
                  className="flex flex-col items-center gap-0.5"
                >
                  <span className="font-display text-sm font-bold text-[#FFF6E9]">
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
  //   Common  card bg #35296A → #19183B, border #3BC8FF, fill #7DFF4D
  //   Rare    card bg #2C2E86,           border #2AAEFF, fill #35C8FF
  //   Epic    card bg #4A216F,           border #D447FF, fill #C85CFF
  // Hard rings replace the previous soft outer glow — the bloomy
  // `shadow-[0_0_14px_rgba(...)]` was bleeding past the card edges
  // and making the borders read as fuzzy. A 2-px ring at full opacity
  // gives crisp UI panel edges; the drop-shadow at the bottom adds
  // depth without colouring the edge.
  const cardBgByRarity: Record<string, string> = {
    common: 'bg-gradient-to-b from-[#35296A] to-[#19183B]',
    rare:   'bg-gradient-to-b from-[#2C2E86] to-[#19183B]',
    epic:   'bg-gradient-to-b from-[#4A216F] to-[#19183B]',
  };
  // Using `border` (1 px) instead of ring-N is intentional: ring is
  // rendered as an OUTSET box-shadow, which gets clipped by the
  // `overflow-hidden` on the mission-stack column parent. border
  // draws INSIDE the element's box (with box-sizing: border-box) so
  // it's never affected by parent overflow. 1 px matches the chest
  // strip's ring-1 visual weight.
  const ringByRarity: Record<string, string> = {
    common: 'border border-[#3BC8FF]',
    rare:   'border border-[#2AAEFF]',
    epic:   'border border-[#D447FF]',
  };
  // Tight drop-shadow (NOT a coloured outer glow) for subtle depth.
  // Same value across all rarities so the cards read as a coherent
  // stack; rarity is expressed via the ring colour + progress fill.
  const glowByRarity: Record<string, string> = {
    common: 'shadow-[0_4px_8px_rgba(0,0,0,0.4)]',
    rare:   'shadow-[0_4px_8px_rgba(0,0,0,0.4)]',
    epic:   'shadow-[0_4px_8px_rgba(0,0,0,0.4)]',
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
      {/* Rarity badge (icon + rarity word baked into the artwork).
          Doubled in size from h-14 → h-28 per operator request. */}
      <div className="shrink-0">
        <img
          src={badgeSrc}
          alt={`${mission.rarity} mission`}
          draggable={false}
          className="h-28 w-28 object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      </div>

      {/* Title, subtitle, progress. Sizes bumped ~20 % per request:
            title    text-2xl → text-3xl
            subtitle text-base → text-lg
          Progress row width 50 % → 60 % and the bar itself
          h-2 → h-2.5 (20 % thicker), count label text-base → text-lg.
       */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-display text-3xl font-bold text-[#FFF6E9]">
            {mission.title}
          </div>
          {/* "+X MP" indicator hidden when the chest sub-feature is
              disabled — those points feed the chest progress, which
              isn't visible right now. mp_earned still accrues
              server-side. */}
          {CHESTS_ENABLED && mission.mission_points > 0 && (
            <span className="rounded-md bg-[#1D2460]/80 px-2 py-0.5 text-sm font-bold text-[#FFD25C] ring-1 ring-[#D89A2B]/40">
              +{mission.mission_points} MP
            </span>
          )}
        </div>
        {mission.subtitle && (
          <div className="truncate text-lg text-[#C6B7D8]">{mission.subtitle}</div>
        )}
        <div className="mt-2 flex max-w-[60%] items-center gap-2">
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[#17122D]">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                progressFillByRarity[mission.rarity] ?? progressFillByRarity.common
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-lg font-bold text-[#FFF6E9]">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>
      </div>

      {/* Rewards — large variant (2× icons + label) per request. */}
      <RewardStack rewards={mission.rewards} large />

      {/* Action button. GO (incomplete) uses the standardized premium
          Play button; CLAIM / CLAIMED keep their own treatment (the
          claim flight animation needs btnRef on that element). */}
      {!isCompleted && !isClaimed ? (
        <PlayButton
          label="GO"
          size="sm"
          disabled={isRerolling}
          onClick={() => onGo?.()}
          wrapClassName="shrink-0"
          wrapStyle={{ fontSize: '20px' }}
        />
      ) : (
        <button
          ref={btnRef}
          type="button"
          disabled={isClaimed || isClaiming || isRerolling}
          onClick={() => {
            if (isClaimed) return;
            if (isCompleted) onClaim(btnRef.current);
          }}
          className={`shrink-0 rounded-lg px-9 py-2.5 text-lg font-bold text-white shadow-md transition ${
            isClaimed
              ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 opacity-90'
              : 'bg-gradient-to-b from-emerald-400 to-emerald-600 hover:brightness-110'
          }`}
        >
          {isClaimed ? 'CLAIMED' : isClaiming ? '…' : 'CLAIM'}
        </button>
      )}
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

  // HORIZONTAL layout — direct port of the operator's reference
  // screenshot. Left column: "WEEKLY / CHALLENGE" gold label + dice
  // icon below. Middle: title at top, 1-line subtitle, progress bar
  // pinned to the bottom with the X / Y count beside it. Right:
  // rewards row at the top, GO button stacked below.
  return (
    <div className="relative flex w-full items-stretch gap-4 rounded-2xl border border-[#E2A93B] bg-gradient-to-b from-[#5C1B8A] to-[#34105D] p-3 shadow-[0_6px_12px_rgba(0,0,0,0.45)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(92,27,138,0.55) 0%, transparent 60%)',
        }}
      />

      {/* LEFT — gold label + dice icon below. justify-center so the
          two elements pack tight instead of stretching to fill. */}
      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2">
        <div className="font-display text-xl font-black uppercase leading-tight tracking-wider text-[#FFD25C] text-center">
          Weekly
          <br />
          Challenge
        </div>
        <img
          src="/lobby/missions/dice-icon.webp"
          alt=""
          draggable={false}
          className="h-12 w-12 object-contain opacity-95"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
      </div>

      {/* MIDDLE — title + subtitle + progress bar. justify-center
          with gap so content sits tight in the middle without the
          empty space pushed by justify-between. */}
      <div className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div>
          <h3 className="font-display text-2xl font-bold leading-tight text-[#FFF6E9]">
            {mission.title}
          </h3>
          {mission.subtitle && (
            <p className="mt-1 text-base leading-snug text-[#C6B7D8]">
              {mission.subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#1A1028]">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isCompleted
                  ? 'bg-emerald-400 shadow-[0_0_12px_rgba(120,255,120,0.45)]'
                  : 'bg-[#B54CFF] shadow-[0_0_14px_rgba(210,80,255,0.5)]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-lg font-bold text-[#FFF6E9]">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>
      </div>

      {/* RIGHT — rewards row + GO button. justify-center keeps the
          pair tight in the middle of the right column. */}
      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-3">
          {mission.rewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <RewardIcon reward={r} large />
              <span className="text-base font-bold text-[#FFF6E9]">
                +{formatAmount(r.amount)}
              </span>
            </div>
          ))}
        </div>

        {!isCompleted && !isClaimed ? (
          <PlayButton label="GO" size="sm" onClick={() => onGo?.()} wrapStyle={{ fontSize: '22px' }} />
        ) : (
          <button
            ref={btnRef}
            type="button"
            disabled={isClaimed || isClaiming}
            onClick={() => {
              if (isClaimed) return;
              if (isCompleted) onClaim(btnRef.current);
            }}
            className={`rounded-lg px-7 py-2 text-xl font-bold text-white shadow-md transition ${
              isClaimed
                ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 opacity-90'
                : 'bg-gradient-to-b from-emerald-400 to-emerald-600'
            }`}
          >
            {isClaimed ? 'CLAIMED' : isClaiming ? '…' : 'CLAIM'}
          </button>
        )}
      </div>
    </div>
  );
}

function RewardStack({
  rewards,
  large = false,
}: {
  readonly rewards: readonly RewardItem[];
  readonly large?: boolean;
}) {
  if (rewards.length === 0) return null;
  // `large` doubles the icon + label sizes for use inside the
  // mission cards (operator request); leaves the default sizes for
  // any other caller.
  const labelClass = large ? 'text-xl font-bold text-amber-100' : 'text-[10px] font-bold text-amber-100';
  const dividerClass = large ? 'h-12 w-px bg-amber-500/30' : 'h-9 w-px bg-amber-500/30';
  return (
    <div className="hidden shrink-0 items-center gap-3 sm:flex">
      {rewards.flatMap((r, i) => {
        const item = (
          <div key={`r-${i}`} className="flex flex-col items-center gap-0.5">
            <RewardIcon reward={r} large={large} />
            <span className={labelClass}>+{formatAmount(r.amount)}</span>
          </div>
        );
        return i === 0
          ? [item]
          : [<div key={`sep-${i}`} className={dividerClass} />, item];
      })}
    </div>
  );
}

function RewardIcon({ reward, large = false }: { readonly reward: RewardItem; readonly large?: boolean }) {
  const sizeClass = large ? 'h-10 w-10' : 'h-7 w-7';
  const xpFontSize = large ? 'text-[12px]' : 'text-[9px]';
  if (reward.reward_kind === 'currency') {
    const iconMap: Record<string, string> = {
      coins: '/lobby/icons/gold-coin.webp',
      gems: '/lobby/icons/gem.webp',
    };
    const src = iconMap[reward.currency_code ?? ''];
    if (reward.currency_code === 'xp') {
      return (
        <div className={`grid ${sizeClass} place-items-center rounded bg-gradient-to-b from-violet-400 to-violet-700 ${xpFontSize} font-black text-white`}>
          XP
        </div>
      );
    }
    if (src) return <img src={src} alt="" className={`${sizeClass} object-contain`} draggable={false} />;
  }
  return <div className={`grid ${sizeClass} place-items-center rounded bg-stone-700 ${xpFontSize} text-white`}>?</div>;
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

  // Layout per the operator's latest reference:
  //   ┌────┐  REROLL                       0/4   ┌─REROLL(FREE)─┐
  //   │ ↻  │  First reroll is free.               └──────────────┘
  //   └────┘
  //   ○ Win streak  ○ Level up  ○ Big gem day  ○ High roller
  //
  // Two-row layout. Top row: icon + stacked title/subtitle + gold
  // counter + button (sized to match the daily-mission GO button —
  // px-6 py-2.5 text-lg — NOT the previous oversized full-height
  // green slab). Bottom row: 4 mission radios on a single line.
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-b from-[#1C4A13] to-[#10270D] px-4 py-3 ring-1 ring-[#64FF57]/60 shadow-[0_0_18px_rgba(100,255,87,0.25)]">
      {/* Top row: icon | title-stack | counter | button */}
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#2C7820] to-[#10270D] text-2xl text-[#FFF6E9] ring-1 ring-[#64FF57]/60">
          ⟳
        </span>

        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <div className="font-display text-2xl font-bold tracking-wide text-[#FFF6E9]">
            REROLL
          </div>
          <div className="text-base text-[#FFF6E9]/85">
            {rerollState.next_cost === null
              ? 'Out of rerolls today.'
              : isFree
                ? 'First reroll is free.'
                : `Next reroll: ${rerollState.next_cost} gems.`}
          </div>
        </div>

        <span className="shrink-0 font-display text-xl font-bold text-[#FFD25C]">
          {rerollState.rerolls_today} / {rerollState.daily_cap}
        </span>

        {/* Button sized to match the daily-mission GO button — same
            px-6 py-2.5 text-lg + shadow-md treatment. Green gradient
            instead of blue. */}
        <button
          type="button"
          disabled={!canReroll || !selectedId || rerollingId !== null}
          onClick={() => selectedId && onReroll(selectedId)}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[#5BE52A] to-[#1D8300] px-6 py-2.5 text-lg font-bold text-white shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="h-5 w-5 object-contain"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
              <span>)</span>
            </>
          )}
        </button>
      </div>

      {/* Bottom row: 4 mission radios on a single horizontal line */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {rerollable.length > 0 ? (
          rerollable.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-2 text-base text-[#FFF6E9]"
            >
              <input
                type="radio"
                name="reroll-target"
                value={m.id}
                checked={selectedId === m.id}
                onChange={() => setSelectedId(m.id)}
                className="h-4 w-4 accent-[#49D61B]"
              />
              <span>{m.title}</span>
            </label>
          ))
        ) : (
          <span className="text-base text-[#C6B7D8]">No rerollable missions.</span>
        )}
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
  const canClaim = streak.current_streak_days >= 7;

  const handleClaim = async () => {
    await supabase.rpc('claim_streak_chest');
  };

  // HORIZONTAL layout — direct port of the reference screenshot.
  // Left: "DAILY / STREAK" gold label + dark "7" box. Middle: "N
  // days" title, 2-line subtitle, progress bar with X/Y to the
  // right. Right: 3 rewards in a row (CLAIM button when day 7+).
  // NO "X days to next chest" footer — count is in the progress
  // label.
  return (
    <div className="relative flex w-full items-stretch gap-4 rounded-2xl border border-[#E2A93B] bg-gradient-to-b from-[#5C1B8A] to-[#34105D] p-3 shadow-[0_6px_12px_rgba(0,0,0,0.45)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(92,27,138,0.55) 0%, transparent 60%)',
        }}
      />

      {/* LEFT — gold "DAILY / STREAK" label + dark square "7" box.
          justify-center + gap-2 packs them tight (no empty space). */}
      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2">
        <div className="font-display text-xl font-black uppercase leading-tight tracking-wider text-[#FFD25C] text-center">
          Daily
          <br />
          Streak
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-lg bg-[#1A1028] ring-1 ring-[#E2A93B]/70">
          <span className="font-display text-2xl font-black text-[#FFD25C]">7</span>
        </div>
      </div>

      {/* MIDDLE — N days + subtitle + progress bar, packed tight */}
      <div className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div>
          <div className="font-display text-2xl font-bold leading-tight text-[#FFF6E9]">
            {streak.current_streak_days} day{streak.current_streak_days === 1 ? '' : 's'}
          </div>
          <p className="mt-1 text-base leading-snug text-[#C6B7D8]">
            Complete all daily missions for 7 days to earn the streak chest.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#1A1028]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#B54CFF] shadow-[0_0_14px_rgba(210,80,255,0.5)]"
              style={{ width: `${((streak.current_streak_days % 7) / 7) * 100}%` }}
            />
          </div>
          <span className="font-mono text-lg font-bold text-[#FFF6E9]">
            {streak.current_streak_days % 7} / 7
          </span>
        </div>
      </div>

      {/* RIGHT — rewards row (3 items horizontal). CLAIM button
          appears only when streak hits 7 days. */}
      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2">
        {streakChestRewards.length > 0 && (
          <div className="flex items-center gap-3">
            {streakChestRewards.map((r, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <RewardIcon reward={r} large />
                <span className="text-base font-bold text-[#FFF6E9]">
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
            className="rounded-lg bg-gradient-to-b from-[#F3C55B] to-[#B67816] px-6 py-2 text-base font-bold text-[#3a1f08] shadow-md hover:brightness-110"
          >
            CLAIM
          </button>
        ) : null}
      </div>
    </div>
  );
}
