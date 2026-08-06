import {type CSSProperties, useRef} from "react"

import type {Mission} from "../../features/lobby/lobbyData"

import {formatAmount, hideImg} from "./missionHelpers"
import {RewardIcon} from "./RewardIcon"
import styles from "./WeeklyCard.module.css"

const rarityClass = {
  common: "",
  rare: styles.weeklyCardRare,
  epic: styles.weeklyCardEpic,
} as const

export function WeeklyCard({
  mission,
  isClaiming,
  onClaim,
  onGo,
}: {
  readonly mission: Mission,
  readonly isClaiming: boolean,
  readonly onClaim: (el: HTMLElement | null) => void,
  readonly onGo: () => void,
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const isCompleted = !!mission.completed_at && !mission.claimed_at
  const isClaimed = !!mission.claimed_at
  const isActive = !isCompleted && !isClaimed
  const pct = Math.min(100, Math.round((mission.progress / Math.max(1, mission.resolved_goal)) * 100))
  return (
    <div className={`${styles.weeklyCard} ${rarityClass[mission.rarity]}`}>
      <div className={styles.weeklyBadge}>
        <img
          alt={`${mission.rarity} mission`}
          draggable={false}
          src={`/lobby/missions/badge-${mission.rarity}.webp`}
          onError={hideImg}/>
      </div>
      <h3 className={styles.weeklyTitle}>{mission.title}</h3>
      {mission.subtitle && <p className={styles.weeklyDescription}>{mission.subtitle}</p>}
      <div className={styles.weeklyProgress}>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{"--progress": pct} as CSSProperties}/>
        </div>
        <div className={styles.progressCount}>
          {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
        </div>
      </div>
      <div className={styles.weeklyRewards}>
        {mission.rewards.map((r) => (
          <div
            key={`${r.amount}-${r.currency_code ?? r.item_id ?? ""}`}
            className={styles.streakRewardItem}>
            <RewardIcon
              reward={r}
              size="lg"/>
            <span>+{formatAmount(r.amount)}</span>
          </div>
        ))}
      </div>
      {isActive ? (
        <button
          className={`${styles.goButton} ${styles.weeklyGoButton}`}
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
          className={`${styles.goButton} ${styles.goButtonClaimed} ${styles.weeklyGoButton}`}
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
        </button>) : (
        <button
          ref={btnRef}
          className={`${styles.goButton} ${styles.weeklyGoButton}`}
          disabled={isClaiming}
          type="button"
          onClick={() => {
            onClaim(btnRef.current)
          }}>
          {isClaiming ? "…" : "Claim"}
        </button>
      )}
    </div>
  )
}
