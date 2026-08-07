import {memo} from "react"

import type {PlayerIdentity} from "../lib/identity"

import {Avatar} from "./Avatar"
import styles from "./PlayerIdentityBlock.module.css"

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
  side: "left" | "right",
  avatarSize: number,
  innerAvatarSize: number,
}

export const PlayerIdentityBlock = memo(function PlayerIdentityBlock({
  identity,
  level,
  stateLabel,
  coinsLabel,
  compact,
  side,
  avatarSize,
  innerAvatarSize,
}: PlayerIdentityBlockProps) {
  const displayName = firstNameOnly(identity?.name)
  const sideClass = side === "right" ? styles.right : styles.left

  if (compact) {
    return (
      <>
        <div
          className={`${styles.compactAvatarStage} ${sideClass}`}
          style={{
            width: avatarSize,
            height: avatarSize,
          }}>
          <Avatar
            className={styles.compactAvatarImage}
            imageUrl={identity?.avatarUrl}
            ring="none"
            seed={identity?.avatarSeed ?? "placeholder"}
            size={innerAvatarSize}/>
          <span className={styles.compactLevel}>
            {level}
          </span>
        </div>
        <div className={`${styles.compactIdentity} ${sideClass}`}>
          <div className={styles.compactName}>
            {displayName}
          </div>
          <div className={styles.compactDetails}>
            <div className={styles.compactLine}>
              <span className={`${styles.compactMeta} ${styles.compactMetaLevel}`}>
                ★
              </span>
              <span>Level {level}</span>
            </div>
            <div className={styles.compactLine}>
              <span className={`${styles.compactMeta} ${styles.compactMetaFlag}`}/>
              <span>{stateLabel}</span>
            </div>
            <div className={styles.compactLine}>
              <span className={`${styles.compactMeta} ${styles.compactMetaCoin}`}>
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
      <div className={`${styles.avatarStage} ${sideClass}`}>
        <div
          aria-hidden="true"
          className={styles.avatarRing}/>
        <div className={styles.avatarClip}>
          <Avatar
            className={styles.avatarImage}
            imageUrl={identity?.avatarUrl}
            ring="none"
            seed={identity?.avatarSeed ?? "placeholder"}
            size={104}/>
        </div>
        <span className={styles.levelShield}>{level}</span>
      </div>

      <div className={`${styles.playerIdentity} ${sideClass}`}>
        <h2>{displayName}</h2>
        <div className={styles.playerLine}>
          <span className={`${styles.metaIcon} ${styles.metaIconLevel}`}>★</span>
          <span>Level {level}</span>
        </div>
        <div className={styles.playerLine}>
          <span className={styles.metaFlag}/>
          <span>{stateLabel}</span>
        </div>
        <div className={styles.playerLine}>
          <span className={`${styles.metaIcon} ${styles.metaIconCoin}`}>$</span>
          <span>{coinsLabel}</span>
        </div>
      </div>
    </>
  )
})
