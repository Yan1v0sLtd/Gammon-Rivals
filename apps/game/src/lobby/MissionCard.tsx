import {type CSSProperties, useRef} from "react"

import type {Mission} from "../features/lobby/lobbyData"

import styles from "./MissionCard.module.css"
import {formatAmount, hideImg} from "./missionHelpers"
import {RewardIcon} from "./RewardIcon"

const rarityClass = {
  common: styles.missionCardCommon,
  rare: styles.missionCardRare,
  epic: styles.missionCardEpic,
} as const

export function MissionCard({
  mission,
  isClaiming,
  canReroll,
  rerollCost,
  onRerollClick,
  onClaim,
  onGo,
}: {
  readonly mission: Mission,
  readonly isClaiming: boolean,
  readonly canReroll: boolean,
  readonly rerollCost: number | null,
  readonly onRerollClick: () => void,
  readonly onClaim: (el: HTMLElement | null) => void,
  readonly onGo: () => void,
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const isCompleted = !!mission.completed_at && !mission.claimed_at
  const isClaimed = !!mission.claimed_at
  const isActive = !isCompleted && !isClaimed
  const pct = Math.min(100, Math.round((mission.progress / Math.max(1, mission.resolved_goal)) * 100))
  // Only COMMON missions can be rerolled — rare/epic are fixed.
  const showReroll = isActive && canReroll && rerollCost !== null && mission.rarity === "common"
  const rerollFree = rerollCost === 0

  return (
    <article className={`${styles.missionCard} ${rarityClass[mission.rarity]} ${isCompleted ? styles.missionCardComplete : ""}`}>
      <div className={styles.missionBadge}>
        <img
          alt={`${mission.rarity} mission`}
          draggable={false}
          src={`/lobby/missions/badge-${mission.rarity}.webp`}
          onError={hideImg}/>
      </div>

      <div className={styles.missionCopy}>
        <p className={styles.missionDescription}>{mission.subtitle ?? mission.title}</p>
        <div className={styles.progressLine}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{"--progress": pct} as CSSProperties}/>
          </div>
          <div className={styles.progressCount}>
            {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className={styles.missionSeparator}/>

      <div className={styles.missionReward}>
        <div>
          <div className={styles.rewardTitle}>Reward</div>
          <div className={styles.rewardIcons}>
            {mission.rewards.map((r) => (
              <div
                key={`${r.amount}-${r.currency_code ?? r.item_id ?? ""}`}
                className={styles.rewardItem}>
                <RewardIcon
                  reward={r}
                  size="md"/>
                <div className={styles.rewardAmount}>+{formatAmount(r.amount)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.missionControls}>
          {isActive ? (
            <button
              className={styles.goButton}
              type="button"
              onClick={onGo}>
              Go
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M9 5l7 7-7 7"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3.2"/>
              </svg>
            </button>
          ) : isClaimed ? (
            <button
              disabled
              className={`${styles.goButton} ${styles.goButtonClaimed}`}
              type="button">
              Claimed
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M5 12.5l4.4 4.4L19 7"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3.4"/>
              </svg>
            </button>
          ) : (
            <button
              ref={btnRef}
              className={styles.goButton}
              disabled={isClaiming}
              type="button"
              onClick={() => {
                onClaim(btnRef.current)
              }}>
              {isClaiming ? "…" : "Claim"}
            </button>
          )}

          {showReroll && (
            <button
              className={styles.rerollNote}
              type="button"
              onClick={onRerollClick}>
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M20 12a8 8 0 1 1-2.4-5.7"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.4"/>
                <path
                  d="M20 4v6h-6"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.4"/>
              </svg>
              <span>{rerollFree ? "Reroll free" : `Reroll · ${rerollCost}💎`}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
