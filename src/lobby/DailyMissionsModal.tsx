import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from './RewardFlight';
import { CHESTS_ENABLED } from './lobbyData';
import { PlayButton } from '../components/PlayButton';
import { ScaleInModal } from '../components/ScaleInModal';
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
 * Daily Missions full-screen modal (redesign v2 — reference-driven).
 *   - Header: dice badge + title + refresh countdown + close.
 *   - Left: daily mission cards (badge | title+desc+progress | REWARD
 *     block | GO/CLAIM), with an inline ↻ reroll on each active card.
 *   - Right: a tabbed rail — DAILY (7-day streak timeline + how-it-works)
 *     and WEEKLY (the weekly challenge(s)), with a dot on the WEEKLY tab
 *     when a weekly reward is claimable.
 *   - Mission Points + chest track stay gated behind CHESTS_ENABLED
 *     (server still accrues mp_earned; the UI just doesn't surface it).
 *
 * Whole panel scales-to-fit so it's fully visible on a landscape phone.
 */
export function DailyMissionsModal({ result, onClose }: Props) {
  const { state, isLoading, error, refetch } = result;
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null);
  const [claimingChestIdx, setClaimingChestIdx] = useState<number | null>(null);
  const [rerollingMissionId, setRerollingMissionId] = useState<string | null>(null);
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const [now, setNow] = useState(Date.now());

  // Reward-flight animation state (mirrors WheelModal): capture the
  // source button rect at claim-time, find the wallet pill via
  // [data-fly-target], spawn N tokens per currency with a stagger.
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

  // Tick the header countdown once a second.
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
  const weeklies = useMemo(
    () => missionsList.filter((m) => m.period === 'weekly').slice(0, 2),
    [missionsList],
  );
  const claimableCount = useMemo(
    () => dailies.filter((m) => m.completed_at && !m.claimed_at).length,
    [dailies],
  );
  const weeklyClaimable = useMemo(
    () => weeklies.some((m) => m.completed_at && !m.claimed_at),
    [weeklies],
  );

  // Scale-to-fit wrapper. Design size 1500 × 800.
  const PANEL_DESIGN_W = 1500;
  const PANEL_DESIGN_H = 800;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(1, (w * 0.98) / PANEL_DESIGN_W, (h * 0.96) / PANEL_DESIGN_H);
      setScale(s);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const countdownMs = useMemo(() => {
    void now;
    return nextResetMs(state);
  }, [state, now]);

  const rerollsLeft = state ? state.reroll.daily_cap - state.reroll.rerolls_today : 0;
  const canRerollAny = rerollsLeft > 0;

  const handleClaim = async (missionId: string, srcEl: HTMLElement | null) => {
    setClaimingMissionId(missionId);
    setActionError(null);
    const mission = missionsList.find((m) => m.id === missionId);
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_mission', { p_mission_id: missionId });
      if (rpcErr) {
        setActionError(extractErrorMessage(rpcErr));
        return;
      }
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
    <>
      <ScaleInModal closeOnBackdropClick={false} closeOnEscape={false}>
        <div className="origin-center" style={{ transform: `scale(${scale})` }}>
          <div
            className="relative flex flex-col rounded-3xl bg-gradient-to-b from-[#162C73] to-[#09051D] p-4 shadow-[0_25px_60px_rgba(0,0,0,0.7)] ring-2 ring-[#D89A2B]/80"
            style={{ width: `${PANEL_DESIGN_W}px`, height: `${PANEL_DESIGN_H}px` }}
          >
            {/* Header */}
            <div className="mb-3 flex shrink-0 items-center gap-3">
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 border-[#D89A2B] bg-gradient-to-b from-[#1D2460] to-[#09051D] shadow-[0_4px_8px_rgba(0,0,0,0.45)]">
                <img
                  src="/lobby/missions/dice-icon.webp"
                  alt=""
                  draggable={false}
                  className="h-12 w-12 object-contain"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              </div>

              <div className="flex shrink-0 flex-col justify-center pr-1">
                <h2 className="font-display text-4xl font-black tracking-wider text-[#FFD25C] leading-none">
                  DAILY MISSIONS
                </h2>
                <p className="mt-1 text-base leading-tight text-[#C6B7D8]" style={{ maxWidth: '20rem' }}>
                  Complete missions. Earn rewards. Keep your streak alive!
                </p>
              </div>

              {/* Chest track (gated off — server still accrues mp_earned). */}
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

              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="rounded-lg bg-[#1D2460]/80 px-3 py-1.5 text-right ring-1 ring-[#D89A2B]/40">
                  <div className="text-xs uppercase tracking-wider text-[#FFD25C]/80">Refreshes in</div>
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
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
                <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-4">
                  {/* Left — daily missions */}
                  <div className="flex min-h-0 flex-col overflow-hidden">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-display text-2xl font-bold tracking-wide text-[#FFF6E9]">
                        DAILY MISSIONS
                      </h3>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 rounded-md bg-[#1C4A13]/70 px-2.5 py-1 text-sm font-bold text-[#9BF584] ring-1 ring-[#64FF57]/40">
                          <span className="text-base leading-none">⟳</span>
                          {rerollsLeft} left
                        </span>
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
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden pb-px">
                      {dailies.map((m) => (
                        <MissionCard
                          key={m.id}
                          mission={m}
                          isClaiming={claimingMissionId === m.id}
                          isRerolling={rerollingMissionId === m.id}
                          rerollCost={state.reroll.next_cost}
                          canReroll={canRerollAny}
                          onClaim={(el) => handleClaim(m.id, el)}
                          onReroll={() => handleReroll(m.id)}
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

                  {/* Right — tabbed rail */}
                  <div className="flex min-h-0 flex-col overflow-hidden">
                    <div className="flex shrink-0 gap-1.5">
                      <TabButton active={tab === 'daily'} onClick={() => setTab('daily')} label="DAILY" />
                      <TabButton
                        active={tab === 'weekly'}
                        onClick={() => setTab('weekly')}
                        label="WEEKLY"
                        dot={weeklyClaimable}
                      />
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl rounded-tr-2xl border border-[#D89A2B]/55 bg-gradient-to-b from-[#101A4D] to-[#070C25] p-4">
                      {tab === 'daily' ? (
                        <StreakTab
                          streak={state.streak}
                          streakChestRewards={state.streak_chest_rewards}
                        />
                      ) : (
                        <WeeklyTab
                          weeklies={weeklies}
                          claimingMissionId={claimingMissionId}
                          onClaim={handleClaim}
                          onGo={onClose}
                        />
                      )}
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
      </ScaleInModal>

      {flights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}
    </>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function TabButton({
  active,
  onClick,
  label,
  dot = false,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 rounded-t-xl px-4 py-2.5 font-display text-lg font-black tracking-wider transition ${
        active
          ? 'bg-gradient-to-b from-[#101A4D] to-[#0B123A] text-[#FFD25C] ring-1 ring-[#D89A2B]/55'
          : 'bg-[#0C1237]/90 text-[#999FC2] ring-1 ring-[#5A5BA0]/30 hover:text-[#C6B7D8]'
      }`}
    >
      {label}
      {dot && (
        <span className="absolute right-3 top-1.5 h-2.5 w-2.5 rounded-full bg-[#E9482F] ring-1 ring-[#ff9d6a]" />
      )}
    </button>
  );
}

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
  const chestSizes = ['h-10', 'h-12', 'h-14', 'h-16'];

  return (
    <div className="flex flex-1 items-center gap-4 rounded-2xl bg-gradient-to-b from-[#1D2460] to-[#162C73] px-4 py-2 ring-1 ring-[#D89A2B]/60">
      <div className="flex shrink-0 flex-col items-center">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-[#FFD25C] to-[#B67816] text-xl text-[#3a1f08] shadow-md ring-2 ring-[#FFD25C]/70">
          ⚡
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-2xl font-black text-[#FFF6E9]">{mpEarned}</span>
          <span className="text-sm text-[#C6B7D8]">/ {maxThreshold}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[#FFD25C]/80">Mission Points</span>
      </div>

      <div className="relative flex-1">
        <div className="absolute left-0 right-0 top-[40%] z-0 h-1.5 -translate-y-1/2 rounded-full bg-[#1B1635]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#FFD25C] to-[#F3C55B] shadow-[0_0_8px_rgba(255,210,92,0.55)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>

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
                className={`flex justify-center transition ${ready ? 'animate-pulse' : ''} ${!unlocked ? 'opacity-50 grayscale' : ''}`}
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

        <div className="mt-1.5 grid grid-cols-4">
          {milestones.map((m) => {
            const claimed = chestsClaimed.includes(m.milestone_index);
            const unlocked = mpEarned >= m.threshold_mp;
            const ready = unlocked && !claimed;
            return (
              <div key={`thr-${m.milestone_index}`} className="flex flex-col items-center gap-0.5">
                <span className="font-display text-sm font-bold text-[#FFF6E9]">{m.threshold_mp}</span>
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

const RARITY_CARD_BG: Record<string, string> = {
  common: 'bg-gradient-to-b from-[#35296A] to-[#19183B]',
  rare: 'bg-gradient-to-b from-[#2C2E86] to-[#19183B]',
  epic: 'bg-gradient-to-b from-[#4A216F] to-[#19183B]',
};
const RARITY_BORDER: Record<string, string> = {
  common: 'border-[#3BC8FF]',
  rare: 'border-[#2AAEFF]',
  epic: 'border-[#D447FF]',
};
const RARITY_FILL: Record<string, string> = {
  common: 'bg-[#7DFF4D] shadow-[0_0_12px_rgba(120,255,120,0.55)]',
  rare: 'bg-[#35C8FF] shadow-[0_0_14px_rgba(60,190,255,0.55)]',
  epic: 'bg-[#C85CFF] shadow-[0_0_14px_rgba(210,80,255,0.55)]',
};

function MissionCard({
  mission,
  isClaiming,
  isRerolling,
  rerollCost,
  canReroll,
  onClaim,
  onReroll,
  onGo,
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly isRerolling: boolean;
  readonly rerollCost: number | null;
  readonly canReroll: boolean;
  readonly onClaim: (sourceEl: HTMLElement | null) => void;
  readonly onReroll: () => void;
  readonly onGo?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [rerollArmed, setRerollArmed] = useState(false);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const isActive = !isCompleted && !isClaimed;
  const progressPct = Math.min(100, (mission.progress / mission.resolved_goal) * 100);
  const showReroll = isActive && canReroll && rerollCost !== null;
  const rerollFree = rerollCost === 0;

  return (
    <div
      className={`flex flex-1 items-center gap-3 rounded-xl border p-3 shadow-[0_4px_8px_rgba(0,0,0,0.4)] ${
        RARITY_CARD_BG[mission.rarity] ?? RARITY_CARD_BG.common
      } ${RARITY_BORDER[mission.rarity] ?? RARITY_BORDER.common}`}
    >
      {/* Badge (rarity + icon baked into the webp art) */}
      <div className="shrink-0">
        <img
          src={`/lobby/missions/badge-${mission.rarity}.webp`}
          alt={`${mission.rarity} mission`}
          draggable={false}
          className="h-24 w-24 object-contain"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
      </div>

      {/* Title + subtitle + progress */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-display text-2xl font-bold text-[#FFF6E9]">{mission.title}</div>
          {CHESTS_ENABLED && mission.mission_points > 0 && (
            <span className="rounded-md bg-[#1D2460]/80 px-2 py-0.5 text-sm font-bold text-[#FFD25C] ring-1 ring-[#D89A2B]/40">
              +{mission.mission_points} MP
            </span>
          )}
        </div>
        {mission.subtitle && <div className="truncate text-base text-[#C6B7D8]">{mission.subtitle}</div>}
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="relative h-2.5 max-w-[260px] flex-1 overflow-hidden rounded-full bg-[#17122D]">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${RARITY_FILL[mission.rarity] ?? RARITY_FILL.common}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className={`font-mono text-base font-bold ${isCompleted || isClaimed ? 'text-[#7DFF45]' : 'text-[#FFF6E9]'}`}>
            {mission.progress} / {mission.resolved_goal}
          </span>
        </div>
      </div>

      {/* REWARD block */}
      <div className="hidden shrink-0 flex-col items-center gap-1 self-stretch justify-center border-l border-[#5C87E1]/35 pl-4 sm:flex">
        <span className="text-xs uppercase tracking-wider text-[#AEBDFF]">Reward</span>
        <div className="flex items-center gap-2.5">
          {mission.rewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <RewardIcon reward={r} large />
              <span className="text-sm font-bold text-[#FFF6E9]">+{formatAmount(r.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action — GO / CLAIM + inline reroll */}
      <div className="flex w-[120px] shrink-0 flex-col items-center gap-1.5">
        {isActive ? (
          <PlayButton label="GO" size="sm" disabled={isRerolling} onClick={() => onGo?.()} wrapStyle={{ fontSize: '20px' }} />
        ) : (
          <button
            ref={btnRef}
            type="button"
            disabled={isClaimed || isClaiming}
            onClick={() => {
              if (isCompleted) onClaim(btnRef.current);
            }}
            className={`w-full rounded-lg px-4 py-2.5 text-lg font-bold text-white shadow-md transition ${
              isClaimed
                ? 'cursor-default bg-gradient-to-b from-emerald-600 to-emerald-800 opacity-90'
                : 'bg-gradient-to-b from-emerald-400 to-emerald-600 hover:brightness-110'
            }`}
          >
            {isClaimed ? 'CLAIMED' : isClaiming ? '…' : 'CLAIM'}
          </button>
        )}

        {showReroll &&
          (rerollArmed ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRerollArmed(false)}
                aria-label="Cancel reroll"
                className="grid h-7 w-7 place-items-center rounded-md bg-[#2A1230] text-sm text-[#E59AB8] ring-1 ring-[#D94CFF]/40 hover:brightness-110"
              >
                ✕
              </button>
              <button
                type="button"
                disabled={isRerolling}
                onClick={() => {
                  setRerollArmed(false);
                  onReroll();
                }}
                className="flex items-center gap-1 rounded-md bg-gradient-to-b from-[#5BE52A] to-[#1D8300] px-2.5 py-1 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
              >
                {isRerolling ? (
                  '…'
                ) : rerollFree ? (
                  <span>Reroll · Free</span>
                ) : (
                  <>
                    <span>Reroll · {rerollCost}</span>
                    <img
                      src="/lobby/icons/gem.webp"
                      alt="gems"
                      draggable={false}
                      className="h-3.5 w-3.5 object-contain"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                    />
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRerollArmed(true)}
              className="flex items-center gap-1 text-xs font-bold text-[#9BC0FF] transition hover:text-[#FFD25C]"
              aria-label="Reroll this mission"
            >
              <span className="text-sm leading-none">⟳</span>
              {rerollFree ? 'Reroll free' : 'Reroll'}
            </button>
          ))}
      </div>
    </div>
  );
}

function StreakTab({
  streak,
  streakChestRewards,
}: {
  readonly streak: { current_streak_days: number; total_streak_chests_claimed: number };
  readonly streakChestRewards: readonly RewardItem[];
}) {
  const daysDone = Math.min(7, streak.current_streak_days);
  const canClaim = streak.current_streak_days >= 7;

  const handleClaim = async () => {
    await supabase.rpc('claim_streak_chest');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-3">
        <span className="font-display text-2xl font-black tracking-wider text-[#FFD25C]">DAILY STREAK</span>
        <span className="rounded-md bg-[#1A1028]/80 px-2.5 py-0.5 font-display text-lg font-black text-[#FFD25C] ring-1 ring-[#E2A93B]/60">
          {streak.current_streak_days} day{streak.current_streak_days === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-sm leading-snug text-[#C6B7D8]">
        Complete all daily missions every day. Hit 7 days to open the streak chest.
      </p>

      <StreakTimeline daysDone={daysDone} />

      {/* Streak chest rewards */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-[#9153FF]/55 bg-gradient-to-b from-[#322264]/95 to-[#10103799] px-5 py-3">
        <div className="flex items-center gap-5">
          {streakChestRewards.length > 0 ? (
            streakChestRewards.map((r, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <RewardIcon reward={r} large />
                <span className="text-base font-bold text-[#FFF6E9]">+{formatAmount(r.amount)}</span>
              </div>
            ))
          ) : (
            <span className="text-sm text-[#C6B7D8]">7-day chest rewards</span>
          )}
        </div>
        {canClaim ? (
          <button
            type="button"
            onClick={handleClaim}
            className="rounded-lg bg-gradient-to-b from-[#F3C55B] to-[#B67816] px-6 py-2 text-base font-bold text-[#3a1f08] shadow-md hover:brightness-110"
          >
            CLAIM
          </button>
        ) : (
          <span className="text-sm font-bold text-[#AEBDFF]">{7 - daysDone} to go</span>
        )}
      </div>

      {/* How it works */}
      <div className="mt-auto pt-4">
        <div className="mb-2 font-display text-base font-bold uppercase tracking-wider text-[#FFF6E9]">
          How it works
        </div>
        <div className="flex flex-col gap-2 text-sm leading-snug text-[#C6B7D8]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#7E31FF] to-[#33126B] text-xs font-black text-white ring-1 ring-[#BA71FF]/60">
              ★
            </span>
            Finish every daily mission to advance your streak and bank the chest.
          </div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#168BFF] to-[#06346C] text-xs font-black text-white ring-1 ring-[#65B8FF]/60">
              ⟳
            </span>
            Don’t like a mission? Reroll it — the first one each day is free.
          </div>
        </div>
      </div>
    </div>
  );
}

function StreakTimeline({ daysDone }: { readonly daysDone: number }) {
  const days = [1, 2, 3, 4, 5, 6];
  return (
    <div className="mt-5 grid grid-cols-7 items-end gap-1">
      {days.map((d) => {
        const done = d <= daysDone;
        return (
          <div key={d} className="relative flex flex-col items-center">
            <span className="mb-2 text-xs font-bold text-[#FFE25C]">DAY {d}</span>
            {/* connector to the next day */}
            <span
              className={`absolute right-[-50%] top-[34px] z-0 h-1 w-full ${
                d < daysDone ? 'bg-[#66DF33]' : 'bg-[#FFDE76]/30'
              }`}
            />
            <span
              className={`relative z-[1] grid h-11 w-11 place-items-center rounded-full border-[3px] text-lg font-black ${
                done
                  ? 'border-[#95FB6A] bg-gradient-to-b from-[#66DF33] to-[#147E0B] text-white shadow-[0_0_14px_rgba(73,255,55,0.4)]'
                  : 'border-[#555967] bg-[#111931] text-transparent'
              }`}
            >
              {done ? '✓' : ''}
            </span>
          </div>
        );
      })}
      {/* Day 7 — the chest milestone */}
      <div className="relative flex flex-col items-center">
        <span className="mb-2 text-xs font-bold text-[#FFE25C]">DAY 7</span>
        <span
          className={`relative z-[1] grid h-12 w-12 place-items-center rounded-xl border-[3px] ${
            daysDone >= 7
              ? 'animate-pulse border-[#FFE066] bg-gradient-to-b from-[#FFD25C] to-[#B67816] shadow-[0_0_16px_rgba(255,210,92,0.6)]'
              : 'border-[#7A5A1E] bg-gradient-to-b from-[#3A2A0C] to-[#1A1228]'
          }`}
        >
          <img
            src="/lobby/missions/chest-3.webp"
            alt="streak chest"
            draggable={false}
            className="h-8 w-8 object-contain"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        </span>
      </div>
    </div>
  );
}

function WeeklyTab({
  weeklies,
  claimingMissionId,
  onClaim,
  onGo,
}: {
  readonly weeklies: readonly Mission[];
  readonly claimingMissionId: string | null;
  readonly onClaim: (missionId: string, srcEl: HTMLElement | null) => void;
  readonly onGo: () => void;
}) {
  if (weeklies.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-center text-[#C6B7D8]">
        <div>
          <img
            src="/lobby/missions/dice-icon.webp"
            alt=""
            draggable={false}
            className="mx-auto mb-3 h-14 w-14 object-contain opacity-70"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          No weekly challenge active right now.
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {weeklies.map((m) => (
        <WeeklyChallengeCard
          key={m.id}
          mission={m}
          isClaiming={claimingMissionId === m.id}
          onClaim={(el) => onClaim(m.id, el)}
          onGo={onGo}
        />
      ))}
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

  return (
    <div className="relative flex w-full flex-1 items-stretch gap-4 rounded-2xl border border-[#E2A93B] bg-gradient-to-b from-[#5C1B8A] to-[#34105D] p-4 shadow-[0_6px_12px_rgba(0,0,0,0.45)]">
      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2">
        <div className="text-center font-display text-xl font-black uppercase leading-tight tracking-wider text-[#FFD25C]">
          Weekly
          <br />
          Challenge
        </div>
        <img
          src="/lobby/missions/dice-icon.webp"
          alt=""
          draggable={false}
          className="h-14 w-14 object-contain opacity-95"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
      </div>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div>
          <h3 className="font-display text-2xl font-bold leading-tight text-[#FFF6E9]">{mission.title}</h3>
          {mission.subtitle && <p className="mt-1 text-base leading-snug text-[#C6B7D8]">{mission.subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[#1A1028]">
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

      <div className="relative z-[1] flex shrink-0 flex-col items-center justify-center gap-2 border-l border-[#E2A93B]/35 pl-4">
        <span className="text-xs uppercase tracking-wider text-[#E9C77A]">Reward</span>
        <div className="flex items-center gap-3">
          {mission.rewards.map((r, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <RewardIcon reward={r} large />
              <span className="text-base font-bold text-[#FFF6E9]">+{formatAmount(r.amount)}</span>
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
