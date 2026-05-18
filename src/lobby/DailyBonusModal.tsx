import { useRef } from 'react';
import type { DailyBonusConfig } from './useDailyBonus';

interface DailyBonusModalProps {
  /** 7 rows, sorted day 1..7. May be empty briefly while loading. */
  readonly configs: readonly DailyBonusConfig[];
  /** The day the user is about to claim (1..7). Highlighted in the grid. */
  readonly upcomingDay: number;
  /** False after a successful claim — Claim button is hidden. */
  readonly canClaim: boolean;
  readonly isClaiming: boolean;
  readonly errorMessage: string | null;
  /** Server response from claim_daily_bonus. Drives the CLAIMED state on
   *  the claimed day card. Null until a claim succeeds. */
  readonly justClaimed: {
    readonly day: number;
    readonly coins: number;
    readonly gems: number;
    readonly xp: number;
  } | null;
  readonly onClaim: () => void;
}

interface DayCardProps {
  readonly day: number;
  readonly gems: number;
  /** True for the day the player can claim right now (gold frame + Claim). */
  readonly isActive: boolean;
  /** True for the day that was just successfully claimed (gold frame +
   *  checkmark + 'CLAIMED' label). */
  readonly isClaimed: boolean;
  /** True for Day 7 — slightly taller, crown above. */
  readonly isMilestone: boolean;
  readonly isClaiming: boolean;
  readonly onClaim: () => void;
}

function Sparkles() {
  return (
    <>
      <span className="pointer-events-none absolute left-[18%] top-[22%] text-[10px] text-amber-400/85">✦</span>
      <span className="pointer-events-none absolute right-[16%] top-[28%] text-[8px] text-amber-300/80">✦</span>
      <span className="pointer-events-none absolute left-[14%] top-[44%] text-[6px] text-amber-400/70">✦</span>
      <span className="pointer-events-none absolute right-[22%] top-[48%] text-[10px] text-amber-300/75">✦</span>
      <span className="pointer-events-none absolute left-[24%] top-[60%] text-[7px] text-amber-400/65">✦</span>
    </>
  );
}

function DayCard({
  day,
  gems,
  isActive,
  isClaimed,
  isMilestone,
  isClaiming,
  onClaim,
}: DayCardProps) {
  const cardHeight = isMilestone ? 'min-h-[17.6rem]' : 'min-h-[16rem]';

  // ACTIVE: claimable now. Gold frame + tab + Claim button.
  if (isActive) {
    return (
      <div className="relative flex flex-col">
        {isMilestone ? (
          <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-[1.65rem] drop-shadow-[0_2px_0_rgba(120,53,15,0.4)]">
            👑
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px] shadow-[0_0_20px_rgba(252,180,40,0.55)] ${
            isMilestone ? 'mt-2' : ''
          }`}
        >
          <div
            className={`relative flex flex-col overflow-hidden rounded-[13px] bg-gradient-to-b from-[#fffaf0] to-[#fdedc7] px-2 pb-2 pt-6 ${cardHeight}`}
          >
            <div className="absolute -top-[1px] left-1/2 z-10 -translate-x-1/2">
              <div className="whitespace-nowrap rounded-b-md border-x border-b border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-md">
                Day&nbsp;{day}
              </div>
            </div>

            <Sparkles />

            <div className="flex flex-1 flex-col items-center justify-center gap-1">
              <img
                src="/lobby/carousel/gem.webp"
                alt=""
                data-fly-source="gems"
                className="h-[3.3rem] w-[3.3rem] select-none drop-shadow-[0_3px_4px_rgba(0,0,0,0.18)]"
                draggable={false}
              />
              <div className="font-display text-[1.65rem] font-black text-amber-950">
                {gems.toLocaleString()}
              </div>
            </div>

            <button
              type="button"
              disabled={isClaiming}
              onClick={onClaim}
              className="mt-2 whitespace-nowrap rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] py-1.5 font-display text-[0.825rem] font-black uppercase tracking-[0.14em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isClaiming ? '…' : 'Claim'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // CLAIMED: just successfully claimed this session. Gold frame stays,
  // gem is replaced by a green check, 'CLAIMED' label replaces the button.
  if (isClaimed) {
    return (
      <div className="relative flex flex-col">
        {isMilestone ? (
          <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-[1.65rem] drop-shadow-[0_2px_0_rgba(120,53,15,0.4)]">
            👑
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px] shadow-[0_0_20px_rgba(252,180,40,0.55)] ${
            isMilestone ? 'mt-2' : ''
          }`}
        >
          <div
            className={`relative flex flex-col overflow-hidden rounded-[13px] bg-gradient-to-b from-[#fffdf3] to-[#fcf1cb] px-2 pb-2 pt-6 ${cardHeight}`}
          >
            <div className="absolute -top-[1px] left-1/2 z-10 -translate-x-1/2">
              <div className="whitespace-nowrap rounded-b-md border-x border-b border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-md">
                Day&nbsp;{day}
              </div>
            </div>

            <Sparkles />

            <div className="flex flex-1 flex-col items-center justify-center gap-1">
              {/* White circle with green check */}
              <div className="grid h-[3.85rem] w-[3.85rem] place-items-center rounded-full border-2 border-emerald-500 bg-white shadow-[0_3px_6px_rgba(0,0,0,0.18)]">
                <svg viewBox="0 0 24 24" className="h-[2.2rem] w-[2.2rem] stroke-emerald-600" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 12 10 18 20 6" />
                </svg>
              </div>
            </div>

            <div className="mt-2 whitespace-nowrap text-center font-display text-[0.825rem] font-black uppercase tracking-[0.14em] text-emerald-700">
              Claimed
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LOCKED / future / past day — neutral cream card with lock at bottom.
  return (
    <div className="relative flex flex-col">
      {isMilestone ? (
        <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-2xl opacity-60 drop-shadow-[0_2px_0_rgba(120,53,15,0.3)]">
          👑
        </div>
      ) : null}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-amber-200/70 bg-[#fdf6e3] px-2 pt-3 shadow-[0_8px_14px_rgba(120,53,15,0.18),0_2px_4px_rgba(120,53,15,0.12)] ${cardHeight} ${
          isMilestone ? 'mt-2' : ''
        }`}
      >
        <div className="whitespace-nowrap text-center font-display text-[12px] font-bold uppercase tracking-[0.14em] text-amber-900/70">
          Day&nbsp;{day}
        </div>
        <div className="mx-auto mt-1 h-px w-11 bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />

        <div className="flex flex-1 flex-col items-center justify-center gap-1 opacity-65">
          <img
            src="/lobby/carousel/gem.webp"
            alt=""
            className="h-11 w-11 select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.12)]"
            draggable={false}
          />
          <div className="font-display text-[1.24rem] font-black text-amber-950">
            {gems.toLocaleString()}
          </div>
        </div>

        <div className="-mx-2 mt-1 border-t border-amber-200/70 bg-amber-50/40 px-2 py-2">
          <div className="text-center text-base text-amber-900/45">🔒</div>
        </div>
      </div>
    </div>
  );
}

export function DailyBonusModal({
  configs,
  upcomingDay,
  canClaim,
  isClaiming,
  errorMessage,
  justClaimed,
  onClaim,
}: DailyBonusModalProps) {
  const byDay = new Map(configs.map((c) => [c.day, c]));
  const rootRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3"
    >
      {/*
       * Outer container uses the gold frame as a background image. The
       * image stretches to 100 % of the container in both axes, so it
       * resizes on every viewport while preserving its corner and edge
       * ornaments (the asset was authored as a thin gold frame so slight
       * non-uniform scaling is visually fine). The cards inside sit on
       * top, centred by the grid, so they keep their position regardless
       * of how the frame stretches.
       *
       * Asset: /public/lobby/daily-bonus/frame.webp
       *   - Drop the gold-frame image at this path. WEBP keeps the bundle
       *     small; .png also works — just update the URL below.
       */}
      <div
        className="relative w-full max-w-4xl bg-no-repeat px-[5.5%] pb-[7%] pt-[6.5%] drop-shadow-[0_25px_50px_rgba(0,0,0,0.6)]"
        style={{
          backgroundImage: "url('/lobby/daily-bonus/frame.webp')",
          backgroundSize: '100% 100%',
        }}
      >
        {/* Title with gold gradient + decorative ornaments */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-lg text-amber-500/80">◆</span>
          <span className="h-px w-12 bg-gradient-to-r from-transparent via-amber-500/70 to-amber-600/80" />
          <h2 className="bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-[2.25rem] font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.6)] md:text-[2.7rem]">
            Daily Bonus
          </h2>
          <span className="h-px w-12 bg-gradient-to-l from-transparent via-amber-500/70 to-amber-600/80" />
          <span className="text-lg text-amber-500/80">◆</span>
        </div>
        <div className="mt-1 flex items-center justify-center gap-2 text-[0.9375rem] font-bold text-amber-900/65">
          <span className="text-amber-500/80">✦</span>
          <span>Come back every day to claim more rewards!</span>
          <span className="text-amber-500/80">✦</span>
        </div>

        {/* 7 day cards. items-end so Day 7's extra height pokes up. */}
        <div className="mt-6 grid grid-cols-7 items-end gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const cfg = byDay.get(day);
            const isActive = day === upcomingDay && canClaim && !justClaimed;
            const isClaimed = !!justClaimed && day === justClaimed.day;
            return (
              <DayCard
                key={day}
                day={day}
                gems={cfg?.reward_gems ?? 0}
                isActive={isActive}
                isClaimed={isClaimed}
                isMilestone={day === 7}
                isClaiming={isClaiming}
                onClaim={onClaim}
              />
            );
          })}
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-md border border-rose-700/40 bg-rose-50 px-3 py-2 text-center text-xs font-bold text-rose-900">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
