import {type CSSProperties, useRef} from "react"

import type {Mission} from "../features/lobby/lobbyData"

import {formatAmount, hideImg} from "./missionHelpers"
import {RewardIcon} from "./RewardIcon"

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
    <article className={`weekly-card is-${mission.rarity} ${isCompleted ? "is-complete" : ""}`}>
      <div className="wk-badge">
        <img
          alt={`${mission.rarity} mission`}
          draggable={false}
          src={`/lobby/missions/badge-${mission.rarity}.webp`}
          onError={hideImg}/>
      </div>
      <h3 className="wk-title">{mission.title}</h3>
      {mission.subtitle && <p className="wk-desc">{mission.subtitle}</p>}
      <div className="wk-progress">
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{"--progress": pct} as CSSProperties}/>
        </div>
        <div className="progress-count">
          {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
        </div>
      </div>
      <div className="wk-rewards">
        {mission.rewards.map((r) => (
          <div
            key={`${r.amount}-${r.currency_code ?? r.item_id ?? ""}`}
            className="streak-reward-item">
            <RewardIcon
              reward={r}
              size="lg"/>
            <span>+{formatAmount(r.amount)}</span>
          </div>
        ))}
      </div>
      {isActive ? (
        <button
          className="go-button wk-go"
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
          className="go-button is-claimed wk-go"
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
          className="go-button wk-go"
          disabled={isClaiming}
          type="button"
          onClick={() => {
            onClaim(btnRef.current)
          }}>
          {isClaiming ? "…" : "Claim"}
        </button>
      )}
    </article>
  )
}
