import {memo, type ReactNode} from "react"

import type {PlayerIdentity} from "../lib/identity"

import {Avatar} from "./Avatar"

const PLACEHOLDER_NAME = "— —"

function firstNameOnly(name: string | null | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed) return PLACEHOLDER_NAME
  return trimmed.split(/\s+/)[0] ?? trimmed
}

type PlayerIdentityBlockProps = {
  identity: PlayerIdentity | null,
  level: number,
  stateLabel: string,
  coinsLabel: string,
  compact: boolean,
  avatarSize: number,
  innerAvatarSize: number,
  textAlign: string,
}

export const PlayerIdentityBlock = memo(function PlayerIdentityBlock({
  identity,
  level,
  stateLabel,
  coinsLabel,
  compact,
  avatarSize,
  innerAvatarSize,
  textAlign,
}: PlayerIdentityBlockProps) {
  const displayName = firstNameOnly(identity?.name)

  if (compact) {
    return (
      <>
        <div
          className="game-compact-avatar-stage"
          style={{
            width: avatarSize,
            height: avatarSize,
          }}>
          <Avatar
            className="game-compact-avatar-image"
            imageUrl={identity?.avatarUrl}
            ring="none"
            seed={identity?.avatarSeed ?? "placeholder"}
            size={innerAvatarSize}/>
          <span className="game-compact-level">
            {level}
          </span>
        </div>
        <div className={`game-compact-identity ${textAlign}`}>
          <div className="game-compact-name">
            {displayName}
          </div>
          <div className="game-compact-details">
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--level">
                ★
              </span>
              <span>Level {level}</span>
            </div>
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--flag"/>
              <span>{stateLabel}</span>
            </div>
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--coin">
                $
              </span>
              <span>{coinsLabel}</span>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="game-avatar-stage">
        <div
          aria-hidden="true"
          className="game-avatar-ring"/>
        <div className="game-avatar-clip">
          <Avatar
            className="game-avatar-image"
            imageUrl={identity?.avatarUrl}
            ring="none"
            seed={identity?.avatarSeed ?? "placeholder"}
            size={104}/>
        </div>
        <span className="game-level-shield">{level}</span>
      </div>

      <div className={`game-player-identity ${textAlign}`}>
        <h2>{displayName}</h2>
        <div className="game-player-line">
          <span className="game-meta-icon game-meta-icon--level">★</span>
          <span>Level {level}</span>
        </div>
        <div className="game-player-line">
          <span className="game-meta-flag"/>
          <span>{stateLabel}</span>
        </div>
        <div className="game-player-line">
          <span className="game-meta-icon game-meta-icon--coin">$</span>
          <span>{coinsLabel}</span>
        </div>
      </div>
    </>
  )
})

type PlayerStatRowProps = {
  icon: "dice" | "score" | "cube",
  label: string,
  value: ReactNode,
  compact?: boolean,
}

const statClasses = {
  desktop: {
    row: {
      dice: "game-stat-row game-stat-row--pip",
      score: "game-stat-row game-stat-row--score",
      cube: "game-stat-row game-stat-row--doubles",
    },
    icon: {
      dice: "game-stat-icon game-stat-icon--dice",
      score: "game-stat-icon game-stat-icon--score",
      cube: "game-stat-icon game-stat-icon--cube",
    },
  },
  compact: {
    row: "game-compact-stat-row",
    icon: {
      dice: "game-compact-stat-icon game-compact-stat-icon--dice",
      score: "game-compact-stat-icon game-compact-stat-icon--score",
      cube: "game-compact-stat-icon game-compact-stat-icon--cube",
    },
  },
} as const

export const PlayerStatRow = memo(function PlayerStatRow({
  icon,
  label,
  value,
  compact = false,
}: PlayerStatRowProps) {
  if (compact) {
    return (
      <div className={statClasses.compact.row}>
        <span className={statClasses.compact.icon[icon]}/>
        <span className="game-compact-stat-copy">
          <span>{label}</span>
          <strong>{value}</strong>
        </span>
      </div>
    )
  }

  return (
    <div className={statClasses.desktop.row[icon]}>
      <span className={statClasses.desktop.icon[icon]}/>
      <span className="game-stat-copy">
        <span className="game-stat-label">{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  )
})

type PlayerPanelShellProps = {
  side: "left" | "right",
  compact: boolean,
  isTurn?: boolean,
  identity: ReactNode,
  stats: ReactNode,
  timer: ReactNode,
  bottomSlot?: ReactNode,
  align: string,
}

export const PlayerPanelShell = memo(function PlayerPanelShell({
  side,
  compact,
  isTurn,
  identity,
  stats,
  timer,
  bottomSlot,
  align,
}: PlayerPanelShellProps) {
  const turnClass = isTurn ? "is-turn" : ""

  if (!compact) {
    return (
      <aside
        className={`game-player-panel game-player-panel--${side} ${turnClass}`}>
        <section className="game-player-card">
          <div className="game-player-card-glow"/>
          <div className="game-player-top">
            {identity}
          </div>

          <div className="game-stat-list">
            <img
              alt=""
              className="game-player-stats-art"
              draggable={false}
              src="/gameplay/premium-purple/player-stats.webp"/>
            {stats}
          </div>

          {timer}
        </section>
        {bottomSlot && <div className="game-panel-bottom">{bottomSlot}</div>}
      </aside>
    )
  }

  return (
    <aside
      className={`game-compact-panel game-player-panel--${side} ${turnClass} ${side === "right" ? "justify-self-end" : "justify-self-start"}`}>
      <div className="game-compact-top">
        {identity}
      </div>

      <div className="game-compact-stat-list">
        {stats}
      </div>

      {timer}
      {bottomSlot && <div className={`flex flex-col ${align} gap-2 w-full`}>{bottomSlot}</div>}
    </aside>
  )
})
