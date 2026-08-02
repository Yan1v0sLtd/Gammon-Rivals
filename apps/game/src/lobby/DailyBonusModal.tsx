import {ScaleInModal} from '../components/ScaleInModal';
import {ModalCloseButton} from '../components/ModalCloseButton';
import type {DailyBonusConfig} from '../features/lobby/lobbySelectors';

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
    readonly day: number; readonly coins: number; readonly gems: number; readonly xp: number;
  } | null;
  /** How many days are already claimed in this 7-day cycle (0..7).
   *  Days 1..N render with the green CLAIMED ribbon. Resets to 0
   *  when the cycle completes (player finished day 7) or breaks
   *  (player missed a day). */
  readonly daysClaimedInCurrentStreak: number;
  readonly onClaim: () => void;
  /** Dismiss the modal. The lobby now opens this modal even when
   *  the player can't claim (already collected today), so an
   *  explicit close affordance is required — tap-outside on the
   *  backdrop also calls this. */
  readonly onClose: () => void;
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
  amount: number; size?: 'sm' | 'md'; /** Tags this gem icon with `data-fly-source="gems"` so the
   *  outside-the-modal flight spawner knows which on-screen icon to
   *  fly from. Only the ACTIVE day passes true — otherwise every day
   *  card emits the attribute and `querySelector` picks the first
   *  one (usually Day 2), making coins fly from the wrong card. */
  isFlightSource?: boolean;
}) {
  const dim = size === 'sm' ? 'h-[1.45em] w-[1.45em]' : 'h-[1.7em] w-[1.7em]';
  return (<div className="flex items-center gap-[0.25em]">
    <img
      src="/lobby/carousel/gem.webp"
      alt=""
      {...(isFlightSource ? {'data-fly-source': 'gems'} : {})}
      className={`${dim} select-none object-contain drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]`}
      draggable={false}
    />
    <span className="font-display text-[1.2em] font-black leading-none text-[#3a1f08]">
        {amount.toLocaleString()}
      </span>
  </div>);
}

function CoinsReward({
  amount,
  isFlightSource = false
}: { amount: number; isFlightSource?: boolean }) {
  return (<div className="flex items-center gap-[0.25em]">
    <img
      src="/lobby/icons/gold-coin.webp"
      alt=""
      {...(isFlightSource ? {'data-fly-source': 'coins'} : {})}
      className="h-[1.7em] w-[1.7em] select-none object-contain drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]"
      draggable={false}
    />
    <span className="font-display text-[1.2em] font-black leading-none text-[#3a1f08]">
        {amount.toLocaleString()}
      </span>
  </div>);
}

/** Inline-SVG purple hexagon with 'XP' label, gold-rimmed. */
function XpReward({amount}: { amount: number }) {
  return (<div className="flex items-center gap-[0.25em]">
    <svg
      viewBox="0 0 100 110"
      className="h-[1.7em] w-auto select-none drop-shadow-[0_6px_5px_rgba(80,40,15,0.5)]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="db-xp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7"/>
          <stop offset="100%" stopColor="#581c87"/>
        </linearGradient>
        <linearGradient id="db-xp-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d"/>
          <stop offset="100%" stopColor="#b45309"/>
        </linearGradient>
      </defs>
      <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="url(#db-xp-rim)"/>
      <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#db-xp-fill)"/>
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
    <span className="font-display text-[1.2em] font-black leading-none text-[#3a1f08]">
        {amount}%
      </span>
  </div>);
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
  if (gems > 0) chips.push(<GemReward key="g" amount={gems} isFlightSource={isActive}/>);
  if (coins > 0) chips.push(<CoinsReward key="c" amount={coins} isFlightSource={isActive}/>);
  if (xp > 0) chips.push(<XpReward key="x" amount={xp}/>);
  if (chips.length === 0) {
    // empty state — keep height stable
    chips.push(<GemReward key="g0" amount={0}/>);
  }
  void isJustClaimed; // currently unused beyond the parent's prop wiring

  // Outer wrapper. For an ACTIVE day we wrap the inner cream surface in
  // a 3-pixel padding outer that hosts the rotating gold border via
  // .daily-bonus-active-frame. For CLAIMED, we use a static gold
  // gradient. For LOCKED we use a flat cream surface with a thin gold
  // accent border.
  const outerClass = ['relative h-full rounded-2xl shadow-[0_10px_14px_-4px_rgba(120,53,15,0.45)]', isActive ? 'daily-bonus-active-frame p-[3px]' : isClaimed ? 'bg-gradient-to-b from-[#fcd34d] via-[#f59e0b] to-[#b45309] p-[3px]' : 'p-0', fullWidth ? 'col-span-3' : '',]
    .filter(Boolean)
    .join(' ');

  const innerBg = isClaimed ? 'bg-gradient-to-b from-[#fff7d4] via-[#fde68a] to-[#fbbf24]' : 'bg-gradient-to-b from-[#fdf6e3] to-[#f7ead0] border border-amber-200/70';

  return (<div className={outerClass}>
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-[14px] ${innerBg}`}
    >
      {/* Diagonal CLAIMED ribbon — top-left corner */}
      {isClaimed ? (<div className="pointer-events-none absolute -left-px -top-px z-10 h-[5em] w-[5em] overflow-hidden">
        <div
          className="absolute -left-[1.6em] top-[0.9em] origin-center -rotate-45 bg-gradient-to-b from-emerald-500 to-emerald-700 px-[2.2em] py-[0.15em] font-display text-[0.6em] font-black uppercase tracking-[0.18em] text-white shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
          Claimed
        </div>
      </div>) : null}

      {/* Green check circle — top-right */}
      {isClaimed ? (<div
        className="pointer-events-none absolute right-[0.5em] top-[0.5em] z-10 grid h-[1.5em] w-[1.5em] place-items-center rounded-full border-[3px] border-emerald-500 bg-white shadow-[0_3px_6px_rgba(0,0,0,0.18)]">
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
          <polyline points="4 12 10 18 20 6"/>
        </svg>
      </div>) : null}

      {/* TOP section: header + reward chip(s). Takes remaining vertical
         *  space so the bottom strip stays a consistent visual band on
         *  every card. */}
      <div className="flex flex-1 flex-col items-center px-[0.7em] pb-[0.4em] pt-[0.5em]">
        {/* Header: ✦ DAY N ✦ */}
        <div className="flex items-center gap-[0.4em]">
          <span className="text-[0.6em] text-amber-600/85">✦</span>
          <span
            className="whitespace-nowrap font-display text-[0.95em] font-black uppercase tracking-[0.14em] text-[#3a1f08]">
              Day&nbsp;{day}
            </span>
          <span className="text-[0.6em] text-amber-600/85">✦</span>
        </div>
        <div
          className="mx-auto mt-[0.3em] h-px w-[60%] bg-gradient-to-r from-transparent via-amber-500/70 to-transparent"/>

        {/* Reward content — ALWAYS a single horizontal row of icon+value
           *  pair(s). The chips are sized small enough that even a 2-reward day
           *  fits the narrow card width without overlapping, AND the row stays
           *  exactly ONE line tall. That keeps every card the same height
           *  (header + 1 reward line [+ CLAIM band]), so the claimable day's
           *  CLAIM button ALWAYS has space below the rewards — no matter how
           *  many rewards the active day has. Day 7 (full width) gets a wider
           *  gap for its 3-reward combo. */}
        <div
          className={`mt-[0.3em] flex flex-1 items-center justify-center ${fullWidth ? 'gap-[1.1em]' : 'gap-[0.45em]'}`}
        >
          {chips}
        </div>
      </div>

      {/* BOTTOM strip — ONLY on the claimable (active) day, to host the
         *  Claim button. Locked / claimed cards omit it entirely so their
         *  reward sits centred in the full card height, matching the mockup
         *  (no empty band). The reward block above is `flex-1`, so it always
         *  centres in whatever height is left. */}
      {isActive ? (<div
        className="flex min-h-[1.5em] items-center justify-center border-t border-amber-300/50 bg-amber-200/35 px-[0.5em] pb-[0.3em] pt-[0.15em]">
        <button
          type="button"
          disabled={isClaiming}
          onClick={onClaim}
          className="whitespace-nowrap rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] px-[1em] py-[0.15em] font-display text-[0.9em] font-black uppercase tracking-[0.1em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isClaiming ? '…' : 'Claim'}
        </button>
      </div>) : null}
    </div>
  </div>);
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
  onClose,
}: DailyBonusModalProps) {
  const byDay = new Map(configs.map((c) => [c.day, c]));

  return (<ScaleInModal onClose={onClose} className="relative origin-center">
    {/*
       * Framed-parchment popup. The gold border, the ornate corner
       * flourishes and the top/bottom centre diamonds are ALL baked into
       * frame.webp (1414×951) — there is no CSS frame anymore. The image
       * defines the box + aspect ratio; the title and the 3+3+1 card grid
       * overlay inside its tan interior "safe area".
       *
       * Sizing lives on the IMAGE: max-width (94vw, capped 1100px) + max-height
       * (86dvh) with w-auto/h-auto, so the browser scales the frame to the
       * largest size that fits BOTH viewport axes using the image's own aspect
       * ratio (no manual aspect math, no vh-vs-dvh surprises). The wrapper
       * shrink-wraps the image (ScaleInModal centres it, so it never stretches),
       * keeping the absolute content overlay aligned at every size.
       */}
    <img
      src="/lobby/daily-bonus/frame.webp"
      alt=""
      draggable={false}
      className="pointer-events-none block h-auto w-auto max-h-[86dvh] max-w-[min(94vw,1100px)] select-none drop-shadow-[0_25px_60px_rgba(0,0,0,0.6)]"
    />

    {/* Close — INSIDE the frame's top-right corner, on the tan field just
          inside the gold corner flourish. Shared with How-to-Play so the two
          close buttons are identical in size + style. */}
    <ModalCloseButton
      onClose={onClose}
      ariaLabel="Close daily bonus"
      className="absolute right-[5.2%] top-[7.5%] z-30"
    />

    {/* Content safe area — inset from the frame edges to clear the gold
          border, the corner flourishes and the centre diamonds. It is a SIZE
          CONTAINER, and the inner wrapper sets a base font-size in `cqh`
          (% of this area's height). Everything below sizes in `em`, so the
          whole composition scales with the FRAME — not the viewport — and
          fits identically at every screen size (incl. short landscape
          phones), instead of `vw` units overflowing the smaller frame. */}
    <div
      className="absolute [container-type:size]"
      style={{
        top: '8.5%',
        right: '6.5%',
        bottom: '7.5%',
        left: '6.5%'
      }}
    >
      <div className="relative flex h-full flex-col text-[3.6cqh] leading-none">
        {/* Title: ✦ ── DAILY BONUS ── ✦ */}
        <div className="flex items-center justify-center gap-[0.5em]">
          <span className="text-[1.1em] text-[#c98a2e]">✦</span>
          <span className="h-[1.5px] w-[1.6em] bg-gradient-to-r from-transparent to-[#c98a2e]/85"/>
          <h2
            className="whitespace-nowrap bg-gradient-to-b from-[#fdeb8f] via-[#f0ad3d] to-[#a4611a] bg-clip-text font-display text-[3.5em] font-black uppercase leading-none tracking-[0.06em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.45)]">
            Daily Bonus
          </h2>
          <span className="h-[1.5px] w-[1.6em] bg-gradient-to-l from-transparent to-[#c98a2e]/85"/>
          <span className="text-[1.1em] text-[#c98a2e]">✦</span>
        </div>
        <div
          className="mt-[0.4em] flex items-center justify-center gap-[0.5em] text-[1.2em] font-bold leading-tight text-[#6e4a26]">
          <span className="text-[#c98a2e]">✦</span>
          <span className="whitespace-nowrap">Come back every day to claim more rewards!</span>
          <span className="text-[#c98a2e]">✦</span>
        </div>

        {/* 3 + 3 + 1 grid — fills the remaining interior height */}
        <div className="mt-[0.7em] grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-[0.55em]">
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
            const isClaimed = isJustClaimed || (day <= daysClaimedInCurrentStreak && !isActive);
            return (<DayCard
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
            />);
          })}
        </div>

        {errorMessage ? (<div
          className="absolute inset-x-0 bottom-0 mx-auto w-fit max-w-[90%] rounded-md border border-rose-700/40 bg-rose-50/95 px-[0.6em] py-[0.3em] text-center text-[0.8em] font-bold leading-tight text-rose-900 shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
          {errorMessage}
        </div>) : null}
      </div>
    </div>
  </ScaleInModal>);
}
