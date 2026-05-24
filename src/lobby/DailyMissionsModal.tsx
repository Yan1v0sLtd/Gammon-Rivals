import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';
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

  const handleClaim = async (missionId: string) => {
    setClaimingMissionId(missionId);
    setActionError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('claim_mission', { p_mission_id: missionId });
      if (rpcErr) setActionError(extractErrorMessage(rpcErr));
      else refetch();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setClaimingMissionId(null);
    }
  };

  const handleClaimAll = async () => {
    const claimables = dailies.filter((m) => m.completed_at && !m.claimed_at);
    for (const m of claimables) {
      await handleClaim(m.id);
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
            <h2 className="font-display text-2xl font-black tracking-wider text-amber-200 sm:text-3xl">
              DAILY MISSIONS
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
                  onClaim={() => handleClaim(m.id)}
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

            {/* Weekly Challenge */}
            {weekly && (
              <div className="mt-4">
                <h3 className="mb-2 font-display text-lg font-bold tracking-wide text-fuchsia-200">
                  WEEKLY CHALLENGE
                </h3>
                <MissionCard
                  mission={weekly}
                  isClaiming={claimingMissionId === weekly.id}
                  isRerolling={false}
                  onClaim={() => handleClaim(weekly.id)}
                  variant="weekly"
                />
              </div>
            )}

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
                {actionError}
              </div>
            )}
          </>
        )}
      </div>
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

  return (
    <div className="mb-4 rounded-xl bg-black/40 p-3 ring-1 ring-amber-500/30">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-black text-amber-200">{mpEarned}</span>
          <span className="text-sm text-amber-100/60">/ {maxThreshold}</span>
          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-200/50">Mission Points</span>
        </div>
      </div>
      <div className="relative h-3 rounded-full bg-black/50">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-amber-200"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        {milestones.map((m) => {
          const claimed = chestsClaimed.includes(m.milestone_index);
          const unlocked = mpEarned >= m.threshold_mp;
          const ready = unlocked && !claimed;
          return (
            <button
              key={m.milestone_index}
              type="button"
              disabled={!ready || claimingIdx !== null}
              onClick={() => onClaimChest(m.milestone_index)}
              className={`flex flex-col items-center gap-0.5 transition ${
                ready ? 'scale-110' : ''
              }`}
              aria-label={`${m.display_name} chest at ${m.threshold_mp} MP`}
            >
              <span
                className={`grid h-8 w-8 place-items-center rounded-lg text-base ring-1 ${
                  claimed
                    ? 'bg-emerald-700 text-emerald-200 ring-emerald-400/40'
                    : ready
                      ? 'animate-pulse bg-gradient-to-b from-amber-300 to-amber-500 text-amber-900 ring-amber-200/80'
                      : 'bg-black/60 text-amber-200/40 ring-amber-500/20'
                }`}
              >
                {claimed ? '✓' : '⌬'}
              </span>
              <span className="text-[10px] text-amber-100/60">{m.threshold_mp}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MissionCard({
  mission,
  isClaiming,
  isRerolling,
  onClaim,
  variant = 'daily',
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly isRerolling: boolean;
  readonly onClaim: () => void;
  readonly variant?: 'daily' | 'weekly';
}) {
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);

  const rarityStyle: Record<string, { badgeBg: string; ring: string; label: string }> = {
    common: { badgeBg: 'from-stone-500 to-stone-700', ring: 'ring-stone-400/40', label: 'COMMON' },
    rare: { badgeBg: 'from-sky-500 to-sky-700', ring: 'ring-sky-300/50', label: 'RARE' },
    epic: { badgeBg: 'from-fuchsia-500 to-fuchsia-700', ring: 'ring-fuchsia-300/50', label: 'EPIC' },
  };
  const rs = rarityStyle[mission.rarity] ?? rarityStyle.common;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl bg-gradient-to-b from-[#241935] to-[#150d24] p-3 ring-1 ${
        rs.ring
      } ${isClaimed ? 'opacity-50' : ''}`}
    >
      {/* Icon + rarity badge */}
      <div className="relative shrink-0">
        <div className="grid h-14 w-14 place-items-center rounded-lg bg-black/40 ring-1 ring-amber-500/30">
          {mission.icon_url ? (
            <img src={mission.icon_url} alt="" className="h-10 w-10 object-contain" draggable={false} />
          ) : (
            <span className="text-2xl">{variant === 'weekly' ? '🏆' : '🎯'}</span>
          )}
        </div>
        <div
          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-gradient-to-b px-1.5 py-0.5 text-[8px] font-black tracking-wider text-white shadow ${rs.badgeBg}`}
        >
          {rs.label}
        </div>
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

      {/* Action button */}
      <button
        type="button"
        disabled={!isCompleted || isClaimed || isClaiming || isRerolling}
        onClick={onClaim}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isCompleted
            ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white hover:brightness-110'
            : 'bg-gradient-to-b from-sky-400 to-sky-600 text-white'
        }`}
      >
        {isClaimed ? 'CLAIMED' : isCompleted ? (isClaiming ? '…' : 'CLAIM') : 'GO'}
      </button>
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
            className="w-full rounded-lg bg-gradient-to-b from-rose-400 to-rose-600 px-3 py-1.5 text-sm font-bold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rerollingId ? 'Rerolling…' : isFree ? 'REROLL (FREE)' : `REROLL (${rerollState.next_cost}g)`}
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
    // Realtime hook will refetch automatically.
  };

  return (
    <div className="rounded-xl bg-gradient-to-b from-orange-900/40 to-rose-900/40 p-3 ring-1 ring-orange-500/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔥</span>
          <span className="font-display font-bold text-amber-100">DAILY STREAK</span>
        </div>
        <span className="text-xs font-bold text-amber-200">{streak.current_streak_days} days</span>
      </div>
      <p className="mt-1 text-[11px] text-amber-100/60">
        Complete all daily missions for 7 days to earn the streak chest.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative h-2 flex-1 rounded-full bg-black/50">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-orange-400 to-rose-400"
            style={{ width: `${((streak.current_streak_days % 7) / 7) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs font-bold text-amber-100">
          {streak.current_streak_days % 7} / 7
        </span>
      </div>
      {canClaim ? (
        <button
          type="button"
          onClick={handleClaim}
          className="mt-2 w-full rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1.5 text-sm font-bold text-amber-950 shadow-md"
        >
          CLAIM STREAK CHEST
        </button>
      ) : (
        <p className="mt-2 text-center text-[11px] text-amber-200/70">
          {daysToChest} day{daysToChest === 1 ? '' : 's'} to next chest
        </p>
      )}
      {streakChestRewards.length > 0 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {streakChestRewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center">
              <RewardIcon reward={r} />
              <span className="text-[9px] font-bold text-amber-100">+{formatAmount(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
