// Visual redesign — gold tab header, sparkles, crown on Day 7.
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
  /** Server response from claim_daily_bonus, shown as a "you got X" celebration
   *  banner once the claim lands. Null until a claim succeeds. */
  readonly justClaimed: {
    readonly day: number;
    readonly coins: number;
    readonly gems: number;
    readonly xp: number;
  } | null;
  readonly onClaim: () => void;
  readonly onClose: () => void;
}

interface DayCardProps {
  readonly day: number;
  readonly gems: number;
  /** True for the day the player can claim right now (gold frame + Claim). */
  readonly isActive: boolean;
  /** True for Day 7 — slightly taller, crown above. */
  readonly isMilestone: boolean;
  readonly isClaiming: boolean;
  readonly onClaim: () => void;
}

function Sparkles() {
  // Tiny absolutely-positioned glyphs inside the active card to evoke
  // the sparkle particles in the reference. Pure CSS, no assets.
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

function DayCard({ day, gems, isActive, isMilestone, isClaiming, onClaim }: DayCardProps) {
  const cardHeight = isMilestone ? 'min-h-[16rem]' : 'min-h-[14.5rem]';

  if (isActive) {
    // Highlighted card with thick gold gradient frame + outer glow,
    // tab-style header on top, sparkle particles, and a Claim button.
    return (
      <div className="relative flex flex-col">
        {isMilestone ? (
          <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-2xl drop-shadow-[0_2px_0_rgba(120,53,15,0.4)]">
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
            {/* Tab-style header */}
            <div className="absolute -top-[1px] left-1/2 z-10 -translate-x-1/2">
              <div className="whitespace-nowrap rounded-b-md border-x border-b border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-3 py-1 font-display text-[10px] font-black uppercase tracking-[0.14em] text-white shadow-md">
                Day&nbsp;{day}
              </div>
            </div>

            <Sparkles />

            {/* Gem + amount, vertically centered in the upper region */}
            <div className="flex flex-1 flex-col items-center justify-center gap-1">
              <img
                src="/lobby/carousel/gem.webp"
                alt=""
                className="h-12 w-12 select-none drop-shadow-[0_3px_4px_rgba(0,0,0,0.18)]"
                draggable={false}
              />
              <div className="font-display text-2xl font-black text-amber-950">
                {gems.toLocaleString()}
              </div>
            </div>

            {/* Claim button anchored at the bottom of the card */}
            <button
              type="button"
              disabled={isClaiming}
              onClick={onClaim}
              className="mt-2 whitespace-nowrap rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] py-1.5 font-display text-xs font-black uppercase tracking-[0.14em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isClaiming ? '…' : 'Claim'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Locked / future / past day — neutral cream card with lock at bottom.
  return (
    <div className="relative flex flex-col">
      {isMilestone ? (
        <div className="absolute -top-4 left-1/2 z-20 -translate-x-1/2 text-2xl opacity-60 drop-shadow-[0_2px_0_rgba(120,53,15,0.3)]">
          👑
        </div>
      ) : null}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-amber-200/70 bg-[#fdf6e3] px-2 pt-3 ${cardHeight} ${
          isMilestone ? 'mt-2' : ''
        }`}
      >
        {/* "Day N" header + thin gold divider */}
        <div className="whitespace-nowrap text-center font-display text-[11px] font-bold uppercase tracking-[0.14em] text-amber-900/70">
          Day&nbsp;{day}
        </div>
        <div className="mx-auto mt-1 h-px w-10 bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />

        {/* Gem + amount, dimmed */}
        <div className="flex flex-1 flex-col items-center justify-center gap-1 opacity-65">
          <img
            src="/lobby/carousel/gem.webp"
            alt=""
            className="h-10 w-10 select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.12)]"
            draggable={false}
          />
          <div className="font-display text-lg font-black text-amber-950">
            {gems.toLocaleString()}
          </div>
        </div>

        {/* Bottom strip with lock icon */}
        <div className="-mx-2 mt-1 border-t border-amber-200/70 bg-amber-50/40 px-2 py-2">
          <div className="text-center text-amber-900/45">🔒</div>
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
  onClose,
}: DailyBonusModalProps) {
  const byDay = new Map(configs.map((c) => [c.day, c]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="w-full max-w-4xl rounded-2xl border border-amber-200 bg-gradient-to-b from-[#fefaf3] to-[#f7ead0] px-5 pb-5 pt-6 shadow-2xl">
        {/* Title with gold gradient + decorative ornaments */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-lg text-amber-400/80">◆</span>
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-amber-500/60" />
          <h2 className="bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] bg-clip-text font-display text-3xl font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.6)] md:text-4xl">
            Daily Bonus
          </h2>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-amber-500/60" />
          <span className="text-lg text-amber-400/80">◆</span>
        </div>
        <div className="mt-1 flex items-center justify-center gap-2 text-xs text-amber-900/70">
          <span className="text-amber-400/70">✦</span>
          <span>
            {canClaim
              ? 'Come back every day to claim more rewards!'
              : 'Come back tomorrow for more rewards!'}
          </span>
          <span className="text-amber-400/70">✦</span>
        </div>

        {/* 7 day cards. items-end so Day 7's extra height pokes up. */}
        <div className="mt-6 grid grid-cols-7 items-end gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const cfg = byDay.get(day);
            return (
              <DayCard
                key={day}
                day={day}
                gems={cfg?.reward_gems ?? 0}
                isActive={day === upcomingDay && canClaim && !justClaimed}
                isMilestone={day === 7}
                isClaiming={isClaiming}
                onClaim={onClaim}
              />
            );
          })}
        </div>

        {/* Status banners */}
        {justClaimed ? (
          <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-50 px-4 py-2 text-center text-sm font-bold text-emerald-900">
            Day {justClaimed.day} claimed!
            <div className="mt-1 flex flex-wrap items-center justify-center gap-3 text-xs">
              {justClaimed.coins > 0 ? <span>+{justClaimed.coins.toLocaleString()} coins</span> : null}
              {justClaimed.gems > 0 ? <span>+{justClaimed.gems.toLocaleString()} gems</span> : null}
              {justClaimed.xp > 0 ? <span>+{justClaimed.xp.toLocaleString()} XP</span> : null}
            </div>
          </div>
        ) : !canClaim ? (
          <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-100/70 px-4 py-2 text-center text-sm font-bold text-amber-900">
            You've already claimed today. Come back tomorrow!
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-3 rounded-md border border-rose-700/40 bg-rose-50 px-3 py-2 text-center text-xs font-bold text-rose-900">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            disabled={isClaiming}
            onClick={onClose}
            className="rounded-md border border-stone-700/50 bg-stone-700 px-6 py-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-stone-50 shadow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
