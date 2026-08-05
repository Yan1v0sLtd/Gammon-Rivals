import {ModalCloseButton} from "../components/ModalCloseButton"
import {ScaleInModal} from "../components/ScaleInModal"
import type {DailyBonusConfig} from "../features/lobby/lobbySelectors"

import styles from "./DailyBonusModal.module.css"

type DailyBonusModalProps = {
  /** 7 rows, sorted day 1..7. May be empty briefly while loading. */
  readonly configs: readonly DailyBonusConfig[],
  /** The day the user is about to claim (1..7). Highlighted in the grid. */
  readonly upcomingDay: number,
  /** False after a successful claim — Claim is hidden. */
  readonly canClaim: boolean,
  readonly isClaiming: boolean,
  readonly errorMessage: string | null,
  readonly justClaimed: {
    readonly day: number, readonly coins: number, readonly gems: number, readonly xp: number,
  } | null,
  /** How many days are already claimed in this 7-day cycle (0..7).
   *  Days 1..N render with the green CLAIMED ribbon. Resets to 0
   *  when the cycle completes (player finished day 7) or breaks
   *  (player missed a day). */
  readonly daysClaimedInCurrentStreak: number,
  readonly onClaim: () => void,
  /** Dismiss the modal. The lobby now opens this modal even when
   *  the player can't claim (already collected today), so an
   *  explicit close affordance is required — tap-outside on the
   *  backdrop also calls this. */
  readonly onClose: () => void,
}

type DayCardProps = {
  readonly day: number,
  readonly coins: number,
  readonly gems: number,
  readonly xp: number,
  readonly isActive: boolean,
  readonly isClaimed: boolean,
  readonly isJustClaimed: boolean,
  readonly fullWidth: boolean,
  readonly isClaiming: boolean,
  readonly onClaim: () => void,
}

/* -------------------------------------------------------------------------- */
/* Reward chips — pure CSS                                                    */

/* -------------------------------------------------------------------------- */

function GemReward({
  amount,
  size = "md",
  isFlightSource = false,
}: {
  amount: number,
  size?: "sm" | "md", /** Tags this gem icon with `data-fly-source="gems"` so the
   *  outside-the-modal flight spawner knows which on-screen icon to
   *  fly from. Only the ACTIVE day passes true — otherwise every day
   *  card emits the attribute and `querySelector` picks the first
   *  one (usually Day 2), making coins fly from the wrong card. */
  isFlightSource?: boolean,
}) {
  const dim = size === "sm" ? styles.rewardImgSm : styles.rewardImgMd
  return (<div className={styles.rewardRow}>
    <img
      alt=""
      src="/lobby/carousel/gem.webp"
      {...(isFlightSource ? {"data-fly-source": "gems"} : {})}
      className={`${styles.rewardImg} ${dim}`}
      draggable={false}/>
    <span className={styles.rewardValue}>
      {amount.toLocaleString()}
    </span>
  </div>)
}

function CoinsReward({
  amount,
  isFlightSource = false,
}: {amount: number, isFlightSource?: boolean}) {
  return (<div className={styles.rewardRow}>
    <img
      alt=""
      src="/lobby/icons/gold-coin.webp"
      {...(isFlightSource ? {"data-fly-source": "coins"} : {})}
      className={`${styles.rewardImg} ${styles.rewardImgMd}`}
      draggable={false}/>
    <span className={styles.rewardValue}>
      {amount.toLocaleString()}
    </span>
  </div>)
}

/** Inline-SVG purple hexagon with 'XP' label, gold-rimmed. */
function XpReward({amount}: {amount: number}) {
  return (<div className={styles.rewardRow}>
    <svg
      aria-hidden="true"
      className={`${styles.rewardImg} ${styles.xpRewardImg}`}
      viewBox="0 0 100 110">
      <defs>
        <linearGradient
          id="db-xp-fill"
          x1="0"
          x2="0"
          y1="0"
          y2="1">
          <stop
            offset="0%"
            stopColor="#a855f7"/>
          <stop
            offset="100%"
            stopColor="#581c87"/>
        </linearGradient>
        <linearGradient
          id="db-xp-rim"
          x1="0"
          x2="0"
          y1="0"
          y2="1">
          <stop
            offset="0%"
            stopColor="#fcd34d"/>
          <stop
            offset="100%"
            stopColor="#b45309"/>
        </linearGradient>
      </defs>
      <polygon
        fill="url(#db-xp-rim)"
        points="50,3 96,28 96,82 50,107 4,82 4,28"/>
      <polygon
        fill="url(#db-xp-fill)"
        points="50,11 88,33 88,77 50,99 12,77 12,33"/>
      <text
        fill="white"
        fontFamily="system-ui, sans-serif"
        fontSize="34"
        fontWeight="900"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
        textAnchor="middle"
        x="50"
        y="68">
        XP
      </text>
    </svg>
    <span className={styles.rewardValue}>
      {amount}%
    </span>
  </div>)
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
  const chips: React.ReactNode[] = []
  if (gems > 0) chips.push(<GemReward
    key="g"
    amount={gems}
    isFlightSource={isActive}/>)
  if (coins > 0) chips.push(<CoinsReward
    key="c"
    amount={coins}
    isFlightSource={isActive}/>)
  if (xp > 0) chips.push(<XpReward
    key="x"
    amount={xp}/>)
  if (chips.length === 0) {
    // empty state — keep height stable
    chips.push(<GemReward
      key="g0"
      amount={0}/>)
  }
  void isJustClaimed // currently unused beyond the parent's prop wiring

  // Outer wrapper. For an ACTIVE day we wrap the inner cream surface in
  // a 3-pixel padding outer that hosts the rotating gold border via
  // .activeFrame in DailyBonusModal.module.css. For CLAIMED, we use a static gold
  // gradient. For LOCKED we use a flat cream surface with a thin gold
  // accent border.
  const outerClass = [styles.dayCard, isActive ? `${styles.activeFrame} ${styles.dayCardActive}` : isClaimed ? styles.dayCardClaimed : "", fullWidth ? styles.dayCardFull : ""]
    .filter(Boolean)
    .join(" ")

  const innerBg = isClaimed ? styles.dayCardInnerClaimed : styles.dayCardInnerLocked

  return (<div className={outerClass}>
    <div
      className={`${styles.dayCardInner} ${innerBg}`}>
      {/* Diagonal CLAIMED ribbon — top-left corner */}
      {isClaimed ? (<div className={styles.claimedRibbonWrap}>
        <div className={styles.claimedRibbon}>
          Claimed
        </div>
      </div>) : null}

      {/* Green check circle — top-right */}
      {isClaimed ? (<div className={styles.claimedCheck}>
        <svg
          aria-hidden="true"
          className={styles.claimedCheckSvg}
          fill="none"
          stroke="#16a34a"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
          viewBox="0 0 24 24">
          <polyline points="4 12 10 18 20 6"/>
        </svg>
      </div>) : null}

      {/* TOP section: header + reward chip(s). Takes remaining vertical
         *  space so the bottom strip stays a consistent visual band on
         *  every card. */}
      <div className={styles.dayTop}>
        {/* Header: ✦ DAY N ✦ */}
        <div className={styles.dayHeader}>
          <span className={styles.dayHeaderStar}>✦</span>
          <span className={styles.dayHeaderText}>
            Day&nbsp;{day}
          </span>
          <span className={styles.dayHeaderStar}>✦</span>
        </div>
        <div className={styles.dayDivider}/>

        {/* Reward content — ALWAYS a single horizontal row of icon+value
           *  pair(s). The chips are sized small enough that even a 2-reward day
           *  fits the narrow card width without overlapping, AND the row stays
           *  exactly ONE line tall. That keeps every card the same height
           *  (header + 1 reward line [+ CLAIM band]), so the claimable day's
           *  CLAIM button ALWAYS has space below the rewards — no matter how
           *  many rewards the active day has. Day 7 (full width) gets a wider
           *  gap for its 3-reward combo. */}
        <div
          className={`${styles.dayRewards} ${fullWidth ? styles.dayRewardsWide : styles.dayRewardsNarrow}`}>
          {chips}
        </div>
      </div>

      {/* BOTTOM strip — ONLY on the claimable (active) day, to host the
         *  Claim button. Locked / claimed cards omit it entirely so their
         *  reward sits centred in the full card height, matching the mockup
         *  (no empty band). The reward block above is `flex-1`, so it always
         *  centres in whatever height is left. */}
      {isActive ? (<div className={styles.claimStrip}>
        <button
          className={styles.claimButton}
          disabled={isClaiming}
          type="button"
          onClick={onClaim}>
          {isClaiming ? "…" : "Claim"}
        </button>
      </div>) : null}
    </div>
  </div>)
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
  const byDay = new Map(configs.map((c) => [c.day, c]))

  return (<ScaleInModal
    className={styles.modalRoot}
    onClose={onClose}>
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
      alt=""
      className={styles.frameImg}
      draggable={false}
      src="/lobby/daily-bonus/frame.webp"/>

    {/* Close — INSIDE the frame's top-right corner, on the tan field just
          inside the gold corner flourish. Shared with How-to-Play so the two
          close buttons are identical in size + style. */}
    <ModalCloseButton
      ariaLabel="Close daily bonus"
      className={styles.closeButton}
      onClose={onClose}/>

    {/* Content safe area — inset from the frame edges to clear the gold
          border, the corner flourishes and the centre diamonds. It is a SIZE
          CONTAINER, and the inner wrapper sets a base font-size in `cqh`
          (% of this area's height). Everything below sizes in `em`, so the
          whole composition scales with the FRAME — not the viewport — and
          fits identically at every screen size (incl. short landscape
          phones), instead of `vw` units overflowing the smaller frame. */}
    <div
      className={styles.contentArea}
      style={{
        top: "8.5%",
        right: "6.5%",
        bottom: "7.5%",
        left: "6.5%",
      }}>
      <div className={styles.contentInner}>
        {/* Title: ✦ ── DAILY BONUS ── ✦ */}
        <div className={styles.titleRow}>
          <span className={styles.titleStar}>✦</span>
          <span className={`${styles.titleLine} ${styles.titleLineLeft}`}/>
          <h2 className={styles.title}>
            Daily Bonus
          </h2>
          <span className={`${styles.titleLine} ${styles.titleLineRight}`}/>
          <span className={styles.titleStar}>✦</span>
        </div>
        <div className={styles.subtitleRow}>
          <span className={styles.subtitleStar}>✦</span>
          <span className={styles.subtitleText}>Come back every day to claim more rewards!</span>
          <span className={styles.subtitleStar}>✦</span>
        </div>

        {/* 3 + 3 + 1 grid — fills the remaining interior height */}
        <div className={styles.grid}>
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const cfg = byDay.get(day)
            const isActive = day === upcomingDay && canClaim && !justClaimed
            const isJustClaimed = !!justClaimed && day === justClaimed.day
            // Show CLAIMED ribbon on every day completed in this
            // 7-day cycle (1..daysClaimedInCurrentStreak), plus
            // the just-claimed day even when the userState hasn't
            // refetched yet. When the cycle resets, this number
            // drops to 0 and every card returns to the default
            // (locked) visual.
            const isClaimed = isJustClaimed || (day <= daysClaimedInCurrentStreak && !isActive)
            return (<DayCard
              key={day}
              coins={cfg?.reward_coins ?? 0}
              day={day}
              fullWidth={day === 7}
              gems={cfg?.reward_gems ?? 0}
              isActive={isActive}
              isClaimed={isClaimed}
              isClaiming={isClaiming}
              isJustClaimed={isJustClaimed}
              xp={cfg?.reward_xp ?? 0}
              onClaim={onClaim}/>)
          })}
        </div>

        {errorMessage ? (<div className={styles.error}>
          {errorMessage}
        </div>) : null}
      </div>
    </div>
  </ScaleInModal>)
}
