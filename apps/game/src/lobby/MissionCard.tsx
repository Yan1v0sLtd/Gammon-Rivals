import {type CSSProperties, useRef} from "react"

import type {Mission} from "../features/lobby/lobbyData"

import {formatAmount, hideImg} from "./missionHelpers"
import {RewardIcon} from "./RewardIcon"

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
    <article className={`mission-card is-${mission.rarity} ${isCompleted ? "is-complete" : ""}`}>
      <div className="mission-badge">
        <img
          alt={`${mission.rarity} mission`}
          draggable={false}
          src={`/lobby/missions/badge-${mission.rarity}.webp`}
          onError={hideImg}/>
      </div>

      <div className="mission-copy">
        <p className="mission-description">{mission.subtitle ?? mission.title}</p>
        <div className="progress-line">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{"--progress": pct} as CSSProperties}/>
          </div>
          <div className="progress-count">
            {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mission-separator"/>

      <div className="mission-reward">
        <div>
          <div className="reward-title">Reward</div>
          <div className="reward-icons">
            {mission.rewards.map((r) => (
              <div
                key={`${r.amount}-${r.currency_code ?? r.item_id ?? ""}`}
                className="reward-item">
                <RewardIcon
                  reward={r}
                  size="md"/>
                <div className="reward-amount">+{formatAmount(r.amount)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mission-controls">
          {isActive ? (
            <button
              className="go-button"
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
              className="go-button is-claimed"
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
              className="go-button"
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
              className="reroll-note"
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
