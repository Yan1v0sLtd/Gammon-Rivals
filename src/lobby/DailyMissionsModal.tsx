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
  const weekly = useMemo(
    () => missionsList.find((m) => m.period === 'weekly') ?? null,
    [missionsList],
  );
  const claimableCount = useMemo(
    () => dailies.filter((m) => m.completed_at && !m.claimed_at).length,
    [dailies],
  );

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8">
      <div className="relative w-full max-w-4xl rounded-3xl bg-gradient-to-b from-[#1c1430] via-[#0f0a1f] to-[#0a0716] p-4 shadow-2xl ring-1 ring-amber-500/40 sm:p-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-3 font-display text-2xl font-black tracking-wider text-amber-200 sm:text-3xl">
              <span>DAILY MISSIONS</span>
              <img
                src="/lobby/missions/dice-icon.webp"
                alt=""
                draggable={false}
                className="h-8 w-8 object-contain sm:h-10 sm:w-10"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            </h2>
            <p className="mt-0.5 text-sm text-amber-100/70">
              Complete missions. Earn points. Claim epic rewards!
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-black/40 px-3 py-1.5 text-right">
              <div className="text-[10px] uppercase tracking-wider text-amber-200/60">Refreshes in</div>
              <div className="font-mono text-sm font-bold text-amber-100">{formatCountdown(countdownMs)}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-10 w-10 place-items-center rounded-full bg-rose-700 text-white shadow-lg ring-2 ring-amber-300/60 transition hover:bg-rose-600"
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
            {/* Mission Points + Chest Track */}
            <ChestTrackStrip
              mpEarned={state.weekly_pass.mp_earned}
              milestones={state.chest_milestones}
              chestsClaimed={state.weekly_pass.chests_claimed}
              claimingIdx={claimingChestIdx}
              onClaimChest={handleClaimChest}
            />

            {/* Action row */}
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold tracking-wide text-amber-100">DAILY MISSIONS</h3>
              <button
                type="button"
                data-claim-all-btn
                disabled={claimableCount === 0 || claimingMissionId !== null}
                onClick={handleClaimAll}
                className="rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-1.5 text-sm font-bold text-amber-950 shadow-md transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {claimableCount > 0 ? `CLAIM ALL (${claimableCount})` : 'CLAIM ALL'}
              </button>
            </div>

            {/* Mission cards */}
            <div className="space-y-2.5">
              {dailies.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  isClaiming={claimingMissionId === m.id}
                  isRerolling={rerollingMissionId === m.id}
                  onClaim={(el) => handleClaim(m.id, el)}
                />
              ))}
              {dailies.length === 0 && (
                <div className="rounded-lg bg-black/30 py-6 text-center text-sm text-amber-200/60">
                  No active missions. Come back at midnight UTC.
                </div>
              )}
            </div>

            {/* Reroll + Streak strip */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <RerollPanel
                rerollState={state.reroll}
                rerollingId={rerollingMissionId}
                dailies={dailies}
                onReroll={handleReroll}
              />
              <StreakPanel
                streak={state.streak}
                streakChestRewards={state.streak_chest_rewards}
              />
            </div>

            {/* Weekly Challenge — ornate purple+gold frame from the
                mockup. The frame artwork has the title plate baked
                in, so we don't render a separate heading. Content
                (mission title, progress, reward, action button) is
                overlaid in absolute-positioned regions tuned to the
                frame's visual layout. */}
            {weekly && (
              <WeeklyChallengeCard
                mission={weekly}
                isClaiming={claimingMissionId === weekly.id}
                onClaim={(el) => handleClaim(weekly.id, el)}
              />
            )}

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
                {actionError}
              </div>
            )}
          </>
        )}
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
    <div className="mb-4 rounded-2xl bg-gradient-to-b from-black/60 to-black/30 p-4 ring-1 ring-amber-500/40">
      {/* Top row: MP value (with lightning-bolt mark) + the chest icons */}
      <div className="flex items-end gap-4 sm:gap-6">
        {/* Lightning + MP count, left-anchored like the mockup */}
        <div className="flex shrink-0 flex-col items-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-600 text-xl text-amber-950 shadow-md ring-2 ring-amber-200/70">
            ⚡
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-display text-2xl font-black text-amber-100">{mpEarned}</span>
            <span className="text-xs text-amber-200/60">/ {maxThreshold}</span>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-amber-200/60">Mission Points</span>
        </div>

        {/* Chest track. Layout, top-to-bottom:
              row 1: chest icons (bottom-aligned, progressively sized)
              row 2: horizontal progress line (BENEATH the chests)
              row 3: threshold numbers
              row 4: claimed checkmark / unclaimed circle
            The progress line is its own row so it doesn't overlap
            the chest artwork — earlier version had it positioned at
            top-1/2 of the row which cut through the chests. */}
        <div className="flex-1">
          {/* Row 1: chests */}
          <div className="flex items-end justify-between">
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
                  className={`flex transition ${
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

          {/* Row 2: progress line, UNDER the chests */}
          <div className="relative mt-1 h-1 rounded-full bg-black/50">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-amber-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Rows 3 + 4: threshold numbers + claimed status circle */}
          <div className="mt-1 flex items-start justify-between">
            {milestones.map((m) => {
              const claimed = chestsClaimed.includes(m.milestone_index);
              const unlocked = mpEarned >= m.threshold_mp;
              const ready = unlocked && !claimed;
              return (
                <div
                  key={`thr-${m.milestone_index}`}
                  className="flex flex-col items-center gap-0.5"
                  style={{
                    // Each label sits over the centre of its chest. Since
                    // the parent uses justify-between, each label's flex
                    // box already aligns to the chest above it.
                  }}
                >
                  <span className="font-display text-xs font-bold text-amber-100">
                    {m.threshold_mp}
                  </span>
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ring-1 ${
                      claimed
                        ? 'bg-emerald-600 text-white ring-emerald-300'
                        : ready
                          ? 'bg-amber-400 text-amber-950 ring-amber-200'
                          : 'bg-black/60 text-transparent ring-amber-500/30'
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
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly isRerolling: boolean;
  readonly onClaim: (sourceEl: HTMLElement | null) => void;
  readonly variant?: 'daily' | 'weekly';
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);

  const ringByRarity: Record<string, string> = {
    common: 'ring-emerald-700/40',
    rare:   'ring-sky-600/50',
    epic:   'ring-fuchsia-600/50',
  };

  // The badge PNG (operator-provided art) bakes the rarity tier
  // and a generic dice/trophy icon into a single artwork — so it
  // replaces both the per-mission icon AND the small rarity label
  // we used in v1. If a mission_template authors a custom icon_url
  // later, we'll layer that on top in a follow-up.
  const badgeSrc = `/lobby/missions/badge-${mission.rarity}.webp`;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl bg-gradient-to-b from-[#241935] to-[#150d24] p-3 ring-1 ${
        ringByRarity[mission.rarity] ?? ringByRarity.common
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
            // Fallback: hide if the asset hasn't been uploaded yet.
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      </div>

      {/* Title, subtitle, progress */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-display text-base font-bold text-amber-50">{mission.title}</div>
          {mission.mission_points > 0 && (
            <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
              +{mission.mission_points} MP
            </span>
          )}
        </div>
        {mission.subtitle && (
          <div className="truncate text-xs text-amber-100/60">{mission.subtitle}</div>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative h-2 flex-1 rounded-full bg-black/50">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isCompleted
                  ? 'bg-emerald-400'
                  : 'bg-gradient-to-r from-amber-400 to-amber-200'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-amber-100">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>
      </div>

      {/* Rewards */}
      <RewardStack rewards={mission.rewards} />

      {/* Action button. CLAIMED keeps the green palette (just darker)
          so the user can still see "this was claimed" as a positive
          state, not a faded/dead button. */}
      <button
        ref={btnRef}
        type="button"
        disabled={!isCompleted || isClaimed || isClaiming || isRerolling}
        onClick={() => onClaim(btnRef.current)}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold shadow-md transition ${
          isClaimed
            ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 text-white opacity-90'
            : isCompleted
              ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white hover:brightness-110'
              : 'bg-gradient-to-b from-sky-400 to-sky-600 text-white disabled:cursor-not-allowed disabled:opacity-50'
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
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly onClaim: (sourceEl: HTMLElement | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);

  return (
    <div
      className="relative mt-4 w-full"
      style={{
        // Aspect ratio of the frame artwork. Adjust if the actual
        // PNG ships at a different ratio.
        aspectRatio: '1438 / 1130',
        backgroundImage: 'url(/lobby/missions/weekly-challenge-frame.webp)',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Content overlay. Padding values are tuned so the inner
          content sits inside the frame's visible area, not over
          the gold trim. */}
      <div className="absolute inset-0 flex flex-col items-center justify-end px-[10%] pb-[8%] pt-[18%]">
        <h3 className="font-display text-base font-bold text-fuchsia-100 sm:text-lg">
          {mission.title}
        </h3>
        {mission.subtitle && (
          <p className="mt-1 text-center text-xs text-fuchsia-200/70 sm:text-sm">
            {mission.subtitle}
          </p>
        )}

        <div className="mt-3 flex w-full max-w-xs items-center gap-2">
          <div className="relative h-2 flex-1 rounded-full bg-black/50">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isCompleted ? 'bg-emerald-400' : 'bg-gradient-to-r from-fuchsia-400 to-fuchsia-200'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-fuchsia-100">
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          {mission.rewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center">
              <RewardIcon reward={r} />
              <span className="text-[10px] font-bold text-fuchsia-100">
                +{formatAmount(r.amount)}
              </span>
            </div>
          ))}
        </div>

        <button
          ref={btnRef}
          type="button"
          disabled={!isCompleted || isClaimed || isClaiming}
          onClick={() => onClaim(btnRef.current)}
          className={`mt-3 rounded-lg px-6 py-1.5 text-sm font-bold shadow-md transition ${
            isClaimed
              ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 text-white opacity-90'
              : isCompleted
                ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white'
                : 'bg-gradient-to-b from-sky-400 to-sky-600 text-white disabled:cursor-not-allowed disabled:opacity-60'
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
  return (
    <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
      {rewards.map((r, i) => (
        <div key={i} className="flex flex-col items-center">
          <RewardIcon reward={r} />
          <span className="text-[10px] font-bold text-amber-100">+{formatAmount(r.amount)}</span>
        </div>
      ))}
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

  return (
    <div className="rounded-xl bg-black/40 p-3 ring-1 ring-amber-500/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔄</span>
          <span className="font-display font-bold text-amber-100">REROLL</span>
        </div>
        <span className="text-xs font-bold text-amber-200">
          {rerollState.rerolls_today} / {rerollState.daily_cap}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-amber-100/60">
        {rerollState.next_cost === null
          ? 'Out of rerolls today.'
          : isFree
            ? 'First reroll is free.'
            : `Next reroll: ${rerollState.next_cost} gems.`}
      </p>
      {canReroll && (
        <div className="mt-2 space-y-1.5">
          {rerollable.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-xs text-amber-100/80">
                <input
                  type="radio"
                  name="reroll-target"
                  value={m.id}
                  checked={selectedId === m.id}
                  onChange={() => setSelectedId(m.id)}
                />
                <span className="truncate">{m.title}</span>
              </label>
            </div>
          ))}
          <button
            type="button"
            disabled={!selectedId || rerollingId !== null}
            onClick={() => selectedId && onReroll(selectedId)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-rose-400 to-rose-600 px-3 py-1.5 text-sm font-bold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50"
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
      )}
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

  // Reusing the Weekly Challenge frame as a generic ornate panel
  // treatment. The frame artwork has "WEEKLY CHALLENGE" baked into
  // its title plate at the top, so we cover that region with our own
  // "🔥 DAILY STREAK" title bar styled to blend with the gold frame.
  // If/when a dedicated daily-streak-frame.webp asset arrives, swap
  // the backgroundImage URL and remove the title overlay.
  return (
    <div
      className="relative w-full"
      style={{
        aspectRatio: '1438 / 1130',
        backgroundImage: 'url(/lobby/missions/weekly-challenge-frame.webp)',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Content overlay inside the frame's interior. (Title bar
          was removed — operator confirmed the title plate is
          handled by the frame artwork itself.) */}
      <div className="absolute inset-0 flex flex-col items-center justify-end px-[8%] pb-[8%] pt-[20%]">
        <div className="mb-2 text-xs font-bold text-amber-200 sm:text-sm">
          {streak.current_streak_days} day{streak.current_streak_days === 1 ? '' : 's'}
        </div>
        <p className="mb-3 text-center text-[11px] text-amber-100/70 sm:text-xs">
          Complete all daily missions for 7 days to earn the streak chest.
        </p>

        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative h-2 flex-1 rounded-full bg-black/60">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-orange-400 to-rose-400"
              style={{ width: `${((streak.current_streak_days % 7) / 7) * 100}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-amber-100">
            {streak.current_streak_days % 7} / 7
          </span>
        </div>

        {streakChestRewards.length > 0 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            {streakChestRewards.map((r, i) => (
              <div key={i} className="flex flex-col items-center">
                <RewardIcon reward={r} />
                <span className="text-[10px] font-bold text-amber-100">+{formatAmount(r.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {canClaim ? (
          <button
            type="button"
            onClick={handleClaim}
            className="mt-3 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-1.5 text-sm font-bold text-amber-950 shadow-md"
          >
            CLAIM STREAK CHEST
          </button>
        ) : (
          <p className="mt-3 text-center text-[11px] text-amber-200/70">
            {daysToChest} day{daysToChest === 1 ? '' : 's'} to next chest
          </p>
        )}
      </div>
    </div>
  );
}
