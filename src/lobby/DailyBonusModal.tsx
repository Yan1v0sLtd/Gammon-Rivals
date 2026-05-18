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
  // Day 7 (milestone) is slightly taller so its crown can sit in a
  // notch above; all other cards align to the bottom via the grid's
  // items-end so the milestone visually sticks up.
  const cardHeight = isMilestone ? 'min-h-[22rem]' : 'min-h-[20rem]';

  // ACTIVE: claimable now. Gold frame + tab + Claim button.
  if (isActive) {
    return (
      <div className="relative flex flex-col">
        {isMilestone ? (
          <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-[2.4rem] drop-shadow-[0_2px_0_rgba(120,53,15,0.4)]">
            👑
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px] shadow-[0_0_20px_rgba(252,180,40,0.55)] ${
            isMilestone ? 'mt-2' : ''
          }`}
        >
          <div
            className={`relative flex flex-col overflow-hidden rounded-[13px] bg-gradient-to-b from-[#fffaf0] to-[#fdedc7] px-2 pb-3 pt-9 ${cardHeight}`}
          >
            <div className="absolute -top-[1px] left-1/2 z-10 -translate-x-1/2">
              <div className="whitespace-nowrap rounded-b-md border-x border-b border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-4 py-1.5 font-display text-[1rem] font-black uppercase tracking-[0.14em] text-white shadow-md">
                Day&nbsp;{day}
              </div>
            </div>

            <Sparkles />

            <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
              <img
                src="/lobby/carousel/gem.webp"
                alt=""
                data-fly-source="gems"
                className="h-[5.5rem] w-[5.5rem] select-none drop-shadow-[0_3px_4px_rgba(0,0,0,0.18)]"
                draggable={false}
              />
              <div className="font-display text-[2.5rem] font-black leading-none text-[#3a1f08]">
                {gems.toLocaleString()}
              </div>
            </div>

            <button
              type="button"
              disabled={isClaiming}
              onClick={onClaim}
              className="mt-2 whitespace-nowrap rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] py-2 font-display text-[1.2rem] font-black uppercase tracking-[0.14em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-[2.4rem] drop-shadow-[0_2px_0_rgba(120,53,15,0.4)]">
            👑
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px] shadow-[0_0_20px_rgba(252,180,40,0.55)] ${
            isMilestone ? 'mt-2' : ''
          }`}
        >
          <div
            className={`relative flex flex-col overflow-hidden rounded-[13px] bg-gradient-to-b from-[#fffdf3] to-[#fcf1cb] px-2 pb-3 pt-9 ${cardHeight}`}
          >
            <div className="absolute -top-[1px] left-1/2 z-10 -translate-x-1/2">
              <div className="whitespace-nowrap rounded-b-md border-x border-b border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-4 py-1.5 font-display text-[1rem] font-black uppercase tracking-[0.14em] text-white shadow-md">
                Day&nbsp;{day}
              </div>
            </div>

            <Sparkles />

            <div className="flex flex-1 flex-col items-center justify-center gap-1">
              {/* White circle with green check */}
              <div className="grid h-[5.5rem] w-[5.5rem] place-items-center rounded-full border-2 border-emerald-500 bg-white shadow-[0_3px_6px_rgba(0,0,0,0.18)]">
                <svg viewBox="0 0 24 24" className="h-[3.2rem] w-[3.2rem] stroke-emerald-600" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 12 10 18 20 6" />
                </svg>
              </div>
            </div>

            <div className="mt-2 whitespace-nowrap text-center font-display text-[1.2rem] font-black uppercase tracking-[0.14em] text-emerald-700">
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
        <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-[2.4rem] opacity-90 drop-shadow-[0_2px_0_rgba(120,53,15,0.3)]">
          👑
        </div>
      ) : null}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-amber-200/70 bg-[#fdf6e3] px-2 pt-4 shadow-[0_8px_14px_rgba(120,53,15,0.18),0_2px_4px_rgba(120,53,15,0.12)] ${cardHeight} ${
          isMilestone ? 'mt-2' : ''
        }`}
      >
        <div className="whitespace-nowrap text-center font-display text-[1rem] font-bold uppercase tracking-[0.14em] text-[#3a1f08]">
          Day&nbsp;{day}
        </div>
        <div className="mx-auto mt-1 h-px w-12 bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />

        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 opacity-90">
          <img
            src="/lobby/carousel/gem.webp"
            alt=""
            className="h-[5rem] w-[5rem] select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.12)]"
            draggable={false}
          />
          <div className="font-display text-[2.2rem] font-black leading-none text-[#3a1f08]">
            {gems.toLocaleString()}
          </div>
        </div>

        <div className="-mx-2 mt-1 flex justify-center border-t border-amber-200/70 bg-amber-50/40 px-2 py-3">
          <LockIcon />
        </div>
      </div>
    </div>
  );
}

/** Solid dark-grey padlock icon for locked day cards. Pure SVG so it
 *  renders consistently across browsers (the Unicode 🔒 was tiny and
 *  rendered differently on iOS vs Windows vs Android). */
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.75rem] w-[1.75rem]"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: '#3a2a1e' }}
    >
      <path d="M12 1.5a5 5 0 0 0-5 5V10H6.5A2.5 2.5 0 0 0 4 12.5v8A2.5 2.5 0 0 0 6.5 23h11a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 17.5 10H17V6.5a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3V10H9V6.5a3 3 0 0 1 3-3zm0 11a2 2 0 0 1 .8 3.83V20.5a.8.8 0 0 1-1.6 0v-2.17A2 2 0 0 1 12 14.5z" />
    </svg>
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
       * ornaments. The whole modal is then scaled down 20 % via the
       * scale-[0.8] wrapper so it occupies less screen real estate
       * without changing internal proportions.
       *
       * Asset: /public/lobby/daily-bonus/frame.webp
       */}
      <div
        className="relative flex w-full max-w-6xl origin-center scale-[0.8] aspect-[1488/983] flex-col bg-no-repeat px-[3.5%] pb-[5%] pt-[5%] drop-shadow-[0_25px_50px_rgba(0,0,0,0.6)]"
        style={{
          backgroundImage: "url('/lobby/daily-bonus/frame.webp')",
          backgroundSize: '100% 100%',
        }}
      >
        {/* Title with gold gradient + decorative ornaments */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-lg text-amber-500/80">◆</span>
          <span className="h-px w-12 bg-gradient-to-r from-transparent via-amber-500/70 to-amber-600/80" />
          <h2 className="bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-[3.25rem] font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.6)] md:text-[3.75rem]">
            Daily Bonus
          </h2>
          <span className="h-px w-12 bg-gradient-to-l from-transparent via-amber-500/70 to-amber-600/80" />
          <span className="text-lg text-amber-500/80">◆</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[1.25rem] font-bold text-amber-900/75">
          <span className="text-amber-500/80">✦</span>
          <span>Come back every day to claim more rewards!</span>
          <span className="text-amber-500/80">✦</span>
        </div>

        {/* 7 day cards. items-end so Day 7's slightly taller card
         *  sticks up; each card has a fixed min-height so the cards
         *  occupy ~60 % of the frame's interior — matches the mockup
         *  where cards sit in the lower 2/3 with cream space below. */}
        <div className="mt-6 grid grid-cols-7 items-end gap-3">
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
