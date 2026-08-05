import {memo} from "react"

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
