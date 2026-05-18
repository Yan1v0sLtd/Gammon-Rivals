import type { DailyBonusConfig } from './useDailyBonus';

interface DailyBonusModalProps {
  /** 7 rows, sorted day 1..7. May be empty briefly while loading. */
  readonly configs: readonly DailyBonusConfig[];
  /** The day the user is about to claim (1..7). Highlighted in the grid. */
  readonly upcomingDay: number;
  /** False after a successful claim — Yes button becomes "Close". */
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
  readonly config: DailyBonusConfig | undefined;
  readonly isUpcoming: boolean;
}

function DayCard({ day, config, isUpcoming }: DayCardProps) {
  const coins = config?.reward_coins ?? 0;
  const gems = config?.reward_gems ?? 0;
  const xp = config?.reward_xp ?? 0;
  return (
    <div
      className={[
        'flex flex-col items-center rounded-lg border px-1.5 py-2 text-center transition',
        isUpcoming
          ? 'border-amber-900 bg-gradient-to-b from-amber-200 to-amber-400 shadow-[0_0_0_2px_rgba(120,53,15,0.4)]'
          : 'border-amber-700/40 bg-amber-50/70',
      ].join(' ')}
    >
      <div className="font-display text-[10px] font-black uppercase tracking-[0.1em] text-amber-900">
        Day {day}
      </div>
      <div className="mt-1 flex flex-col items-center gap-0.5 text-[10px] font-bold leading-tight text-amber-950">
        {coins > 0 ? (
          <div className="flex items-center gap-0.5">
            <span>🪙</span>
            <span>{coins.toLocaleString()}</span>
          </div>
        ) : null}
        {gems > 0 ? (
          <div className="flex items-center gap-0.5">
            <img
              src="/lobby/carousel/gem.webp"
              alt=""
              className="h-3 w-3 select-none"
              draggable={false}
            />
            <span>{gems.toLocaleString()}</span>
          </div>
        ) : null}
        {xp > 0 ? <div>+{xp.toLocaleString()} XP</div> : null}
        {coins + gems + xp === 0 ? <div className="text-amber-900/40">—</div> : null}
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
  const showClaimButton = canClaim && !justClaimed;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-w-md rounded-xl border-2 border-amber-700 bg-gradient-to-b from-amber-100 to-amber-300 px-6 py-5 text-center text-amber-950 shadow-2xl">
        <div className="font-display text-lg uppercase tracking-wider">Daily bonus</div>
        <div className="mt-1 text-xs text-amber-900/80">
          Log in every day to keep your streak. Missing a day resets you to Day 1.
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <DayCard
              key={day}
              day={day}
              config={byDay.get(day)}
              isUpcoming={!justClaimed && day === upcomingDay}
            />
          ))}
        </div>

        {justClaimed ? (
          <div className="mt-4 rounded-lg border border-emerald-800/40 bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-900">
            Day {justClaimed.day} claimed!
            <div className="mt-1 flex flex-wrap items-center justify-center gap-3 text-xs">
              {justClaimed.coins > 0 ? <span>+{justClaimed.coins.toLocaleString()} coins</span> : null}
              {justClaimed.gems > 0 ? <span>+{justClaimed.gems.toLocaleString()} gems</span> : null}
              {justClaimed.xp > 0 ? <span>+{justClaimed.xp.toLocaleString()} XP</span> : null}
            </div>
          </div>
        ) : !canClaim ? (
          <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-50/70 px-4 py-3 text-sm font-bold text-amber-900">
            You've already claimed today. Come back tomorrow!
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-3 rounded-md border border-rose-700/40 bg-rose-100 px-3 py-2 text-xs font-bold text-rose-900">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-4 flex justify-center gap-3">
          {showClaimButton ? (
            <button
              type="button"
              disabled={isClaiming || configs.length === 0}
              onClick={onClaim}
              className="rounded-md border border-amber-900 bg-amber-700 px-5 py-2 font-medium text-amber-50 shadow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isClaiming ? 'Claiming…' : 'Claim'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isClaiming}
            onClick={onClose}
            className="rounded-md border border-stone-900 bg-stone-700 px-5 py-2 font-medium text-stone-100 shadow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
