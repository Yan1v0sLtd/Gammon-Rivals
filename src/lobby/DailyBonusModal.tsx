import type { DailyBonusConfig } from './useDailyBonus';

interface DailyBonusModalProps {
  /** 7 rows, sorted day 1..7. May be empty briefly while loading. */
  readonly configs: readonly DailyBonusConfig[];
  /** The day the user is about to claim (1..7). Highlighted in the grid. */
  readonly upcomingDay: number;
  /** False after a successful claim — Claim is hidden. */
  readonly canClaim: boolean;
  readonly isClaiming: boolean;
  readonly errorMessage: string | null;
  readonly justClaimed: {
    readonly day: number;
    readonly coins: number;
    readonly gems: number;
    readonly xp: number;
  } | null;
  /** How many days are already claimed in this 7-day cycle (0..7).
   *  Days 1..N render with the green CLAIMED ribbon. Resets to 0
   *  when the cycle completes (player finished day 7) or breaks
   *  (player missed a day). */
  readonly daysClaimedInCurrentStreak: number;
  readonly onClaim: () => void;
}

interface DayCardProps {
  readonly day: number;
  readonly coins: number;
  readonly gems: number;
  readonly xp: number;
  readonly isActive: boolean;
  readonly isClaimed: boolean;
  readonly isJustClaimed: boolean;
  readonly fullWidth: boolean;
  readonly isClaiming: boolean;
  readonly onClaim: () => void;
}

/* -------------------------------------------------------------------------- */
/* Reward chips — pure CSS                                                    */
/* -------------------------------------------------------------------------- */

function GemReward({
  amount,
  size = 'md',
  isFlightSource = false,
}: {
  amount: number;
  size?: 'sm' | 'md';
  /** Tags this gem icon with `data-fly-source="gems"` so the
   *  outside-the-modal flight spawner knows which on-screen icon to
   *  fly from. Only the ACTIVE day passes true — otherwise every day
   *  card emits the attribute and `querySelector` picks the first
   *  one (usually Day 2), making coins fly from the wrong card. */
  isFlightSource?: boolean;
}) {
  const dim = size === 'sm' ? 'h-[clamp(2rem,4.5vw,3.25rem)] w-[clamp(2rem,4.5vw,3.25rem)]' : 'h-[clamp(2.25rem,5vw,3.75rem)] w-[clamp(2.25rem,5vw,3.75rem)]';
  return (
    <div className="flex items-center gap-2">
      <img
        src="/lobby/carousel/gem.webp"
        alt=""
        {...(isFlightSource ? { 'data-fly-source': 'gems' } : {})}
        className={`${dim} select-none object-contain drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]`}
        draggable={false}
      />
      <span className="font-display text-[clamp(1.1rem,2.6vw,2rem)] font-black leading-none text-[#3a1f08]">
        {amount.toLocaleString()}
      </span>
    </div>
  );
}

function CoinsReward({ amount, isFlightSource = false }: { amount: number; isFlightSource?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img
        src="/lobby/icons/gold-coin.webp"
        alt=""
        {...(isFlightSource ? { 'data-fly-source': 'coins' } : {})}
        className="h-[clamp(2.25rem,5vw,3.75rem)] w-[clamp(2.25rem,5vw,3.75rem)] select-none object-contain drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]"
        draggable={false}
      />
      <span className="font-display text-[clamp(1.1rem,2.6vw,2rem)] font-black leading-none text-[#3a1f08]">
        {amount.toLocaleString()}
      </span>
    </div>
  );
}

/** Inline-SVG purple hexagon with 'XP' label, gold-rimmed. */
function XpReward({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        viewBox="0 0 100 110"
        className="h-[clamp(2.25rem,5vw,3.75rem)] w-auto select-none drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="db-xp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#581c87" />
          </linearGradient>
          <linearGradient id="db-xp-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
        <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="url(#db-xp-rim)" />
        <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#db-xp-fill)" />
        <text
          x="50"
          y="68"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontWeight="900"
          fontSize="34"
          fill="white"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="1"
        >
          XP
        </text>
      </svg>
      <span className="font-display text-[clamp(1.1rem,2.6vw,2rem)] font-black leading-none text-[#3a1f08]">
        {amount}%
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DayCard                                                                    */
/* -------------------------------------------------------------------------- */

function DayCard({
  day,
  coins,
  gems,
  xp,
  isActive,
  isClaimed,
  isJustClaimed,
  fullWidth,
  isClaiming,
  onClaim,
}: DayCardProps) {
  // Decide which reward chips to render. For Day 7 (fullWidth) we show
  // every non-zero reward type in a row so the milestone day reads as
  // a combo. For other days, render in priority order — usually the day
  // is configured with exactly one reward type, so this acts as
  // "render whatever's set".
  // The flight-source flag piggybacks on the ACTIVE card's icons so
  // the LobbyScreen spawner can use querySelector to find the right
  // origin point. Without it, every day card stamps the same
  // attribute and querySelector picks the FIRST one (Day 2 in the
  // default config), making the reward coins fly from the wrong card.
  const chips: React.ReactNode[] = [];
  if (gems > 0) chips.push(<GemReward key="g" amount={gems} isFlightSource={isActive} />);
  if (coins > 0) chips.push(<CoinsReward key="c" amount={coins} isFlightSource={isActive} />);
  if (xp > 0) chips.push(<XpReward key="x" amount={xp} />);
  if (chips.length === 0) {
    // empty state — keep height stable
    chips.push(<GemReward key="g0" amount={0} />);
  }
  void isJustClaimed; // currently unused beyond the parent's prop wiring

  // Outer wrapper. For an ACTIVE day we wrap the inner cream surface in
  // a 3-pixel padding outer that hosts the rotating gold border via
  // .daily-bonus-active-frame. For CLAIMED, we use a static gold
  // gradient. For LOCKED we use a flat cream surface with a thin gold
  // accent border.
  const outerClass = [
    'relative rounded-2xl shadow-[0_10px_14px_-4px_rgba(120,53,15,0.45)]',
    isActive
      ? 'daily-bonus-active-frame p-[3px]'
      : isClaimed
        ? 'bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px]'
        : 'p-0',
    fullWidth ? 'col-span-3' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const innerBg = isClaimed
    ? 'bg-gradient-to-b from-[#fff7d4] via-[#fde68a] to-[#fbbf24]'
    : 'bg-gradient-to-b from-[#fdf6e3] to-[#f7ead0] border border-amber-200/70';

  return (
    <div className={outerClass}>
      <div
        className={`relative flex flex-col overflow-hidden rounded-[14px] ${innerBg}`}
      >
        {/* Diagonal CLAIMED ribbon — top-left corner */}
        {isClaimed ? (
          <div className="pointer-events-none absolute -left-px -top-px z-10 h-24 w-24 overflow-hidden">
            <div className="absolute -left-7 top-4 origin-center -rotate-45 bg-gradient-to-b from-emerald-500 to-emerald-700 px-9 py-1 font-display text-[clamp(0.55rem,1.1vw,0.8rem)] font-black uppercase tracking-[0.18em] text-white shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
              Claimed
            </div>
          </div>
        ) : null}

        {/* Green check circle — top-right */}
        {isClaimed ? (
          <div className="pointer-events-none absolute right-2 top-2 z-10 grid h-[clamp(1.5rem,3vw,2.25rem)] w-[clamp(1.5rem,3vw,2.25rem)] place-items-center rounded-full border-[3px] border-emerald-500 bg-white shadow-[0_3px_6px_rgba(0,0,0,0.18)]">
            <svg
              viewBox="0 0 24 24"
              className="h-[60%] w-[60%]"
              fill="none"
              stroke="#16a34a"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="4 12 10 18 20 6" />
            </svg>
          </div>
        ) : null}

        {/* TOP section: header + reward chip(s). Takes remaining vertical
         *  space so the bottom strip stays a consistent visual band on
         *  every card. */}
        <div className="flex flex-1 flex-col items-center px-3 pb-2 pt-3">
          {/* Header: ✦ DAY N ✦ */}
          <div className="flex items-center gap-2">
            <span className="text-[clamp(0.55rem,1.1vw,0.85rem)] text-amber-600/85">✦</span>
            <span className="whitespace-nowrap font-display text-[clamp(0.88rem,1.88vw,1.31rem)] font-black uppercase tracking-[0.14em] text-[#3a1f08]">
              Day&nbsp;{day}
            </span>
            <span className="text-[clamp(0.55rem,1.1vw,0.85rem)] text-amber-600/85">✦</span>
          </div>
          <div className="mx-auto mt-1 h-px w-[60%] bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />

          {/* Reward content — horizontal icon+value pair(s) */}
          <div
            className={`mt-2 flex flex-1 items-center justify-center ${fullWidth ? 'gap-6' : 'gap-2'}`}
          >
            {chips}
          </div>
        </div>

        {/* BOTTOM strip — consistent darker band across all cards.
         *  Active cards host the Claim button here; locked / claimed
         *  cards leave it visually empty so every box has the same
         *  two-tone "reward zone + action zone" footprint. */}
        <div className="flex min-h-[clamp(3rem,5vw,4.25rem)] items-center justify-center border-t border-amber-300/50 bg-amber-200/35 px-3 py-2">
          {isActive ? (
            <button
              type="button"
              disabled={isClaiming}
              onClick={onClaim}
              className="whitespace-nowrap rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-8 py-2 font-display text-[clamp(1.3rem,2.6vw,2rem)] font-black uppercase tracking-[0.12em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isClaiming ? '…' : 'Claim'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */
/* -------------------------------------------------------------------------- */

export function DailyBonusModal({
  configs,
  upcomingDay,
  canClaim,
  isClaiming,
  errorMessage,
  justClaimed,
  daysClaimedInCurrentStreak,
  onClaim,
}: DailyBonusModalProps) {
  const byDay = new Map(configs.map((c) => [c.day, c]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      {/*
       * CSS-only panel. Three nested layers for the gold-on-cream "framed
       * parchment" look:
       *   outer: thick gold gradient rim (5 px)
       *   mid:   thin gold band (2 px) for the double-border feel
       *   inner: cream gradient interior where the title + cards live
       *
       * Title and cards now define the modal's height; no background
       * image, no aspect-ratio constraint.
       */}
      <div className="relative w-full max-w-5xl origin-center scale-[0.45] rounded-3xl bg-gradient-to-b from-[#fde68a] via-[#d97706] to-[#78350f] p-[5px] shadow-[0_25px_60px_rgba(0,0,0,0.65)] lg:scale-[0.74]">
        <div className="rounded-[22px] bg-gradient-to-b from-[#fef3c7] via-[#fbbf24] to-[#92400e] p-[2px]">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-b from-[#f7e9c8] to-[#e7d09a] px-[clamp(1rem,3vw,2.5rem)] pb-[clamp(1rem,3vw,2rem)] pt-[clamp(1rem,3vw,2rem)]">
            {/* Top + bottom decorative lozenges */}
            <div
              aria-hidden="true"
              className="absolute -top-[12px] left-1/2 z-20 h-6 w-6 -translate-x-1/2 rotate-45 rounded-[3px] bg-gradient-to-br from-[#fef08a] via-[#f59e0b] to-[#7c2d12] shadow-[0_3px_8px_rgba(120,53,15,0.55),inset_0_1px_0_rgba(255,255,255,0.5)]"
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-[12px] left-1/2 z-20 h-6 w-6 -translate-x-1/2 rotate-45 rounded-[3px] bg-gradient-to-br from-[#fef08a] via-[#f59e0b] to-[#7c2d12] shadow-[0_3px_8px_rgba(120,53,15,0.55),inset_0_1px_0_rgba(255,255,255,0.5)]"
            />
            {/* Title */}
            <div className="flex items-center justify-center gap-4">
              <span className="text-lg text-amber-500/80">◆</span>
              <span className="h-px w-12 bg-gradient-to-r from-transparent via-amber-500/70 to-amber-600/80" />
              <h2 className="whitespace-nowrap bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-[clamp(2rem,6.3vw,4.3rem)] font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.6)]">
                Daily Bonus
              </h2>
              <span className="h-px w-12 bg-gradient-to-l from-transparent via-amber-500/70 to-amber-600/80" />
              <span className="text-lg text-amber-500/80">◆</span>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-[clamp(0.86rem,1.95vw,1.44rem)] font-bold text-amber-900/80">
              <span className="text-amber-500/80">✦</span>
              <span className="whitespace-nowrap">Come back every day to claim more rewards!</span>
              <span className="text-amber-500/80">✦</span>
            </div>

            {/* 3 + 3 + 1 grid */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const cfg = byDay.get(day);
                const isActive = day === upcomingDay && canClaim && !justClaimed;
                const isJustClaimed = !!justClaimed && day === justClaimed.day;
                // Show CLAIMED ribbon on every day completed in this
                // 7-day cycle (1..daysClaimedInCurrentStreak), plus
                // the just-claimed day even when the userState hasn't
                // refetched yet. When the cycle resets, this number
                // drops to 0 and every card returns to the default
                // (locked) visual.
                const isClaimed =
                  isJustClaimed ||
                  (day <= daysClaimedInCurrentStreak && !isActive);
                return (
                  <DayCard
                    key={day}
                    day={day}
                    coins={cfg?.reward_coins ?? 0}
                    gems={cfg?.reward_gems ?? 0}
                    xp={cfg?.reward_xp ?? 0}
                    isActive={isActive}
                    isClaimed={isClaimed}
                    isJustClaimed={isJustClaimed}
                    fullWidth={day === 7}
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
      </div>
    </div>
  );
}

