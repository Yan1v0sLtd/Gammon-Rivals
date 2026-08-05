import {Link} from "react-router-dom"

import type {Database} from "../../../../packages/shared/src/database"
import type {ProfileProgression} from "../../../../packages/shared/src/progression"
import {Avatar} from "../components/Avatar"

import styles from "./LobbyProfileCard.module.css"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

type LobbyProfileCardProps = {
  readonly profile: ProfileRow | null,
  readonly progression: ProfileProgression,
}

/**
 * Minimal lobby top-bar profile widget: just the avatar (with level
 * shield) and, directly below it, the XP progress bar sized to the
 * avatar's circle. Name, rank and the LEVEL → LEVEL row were removed from
 * the lobby per operator direction — those details live on the /profile
 * page, which this widget links to.
 */
export function LobbyProfileCard({
  profile,
  progression,
}: LobbyProfileCardProps) {
  return (<Link
    aria-label="Open profile"
    className={styles.profilePill}
    data-fly-target="xp"
    to="/profile">
    <span
      aria-hidden="true"
      className={styles.profilePillShine}/>

    <div className={styles.profilePillContent}>
      <div className={styles.profilePillIdentity}>
        <div className={styles.profilePillAvatarWrap}>
          <div className={styles.profilePillAvatarRing}>
            <span
              aria-hidden="true"
              className={`${styles.profilePillSpark} ${styles.profilePillSpark1}`}/>
            <span
              aria-hidden="true"
              className={`${styles.profilePillSpark} ${styles.profilePillSpark2}`}/>

            <div className={styles.profilePillAvatarImg}>
              <Avatar
                imageUrl={profile?.avatar_url}
                ring="none"
                seed={profile?.avatar_seed ?? "guest"}
                size={240}/>
            </div>

            <div className={styles.profilePillShield}>
              <span>{progression.level}</span>
            </div>
          </div>
        </div>
      </div>

      {/* XP bar — directly below the avatar, sized to the avatar circle
            (see .profilePillContent + .profilePillXpBar in the module). It's
            the only text element left in the card. */}
      <div
        aria-label="Level progress"
        className={styles.profilePillXpBar}>
        <div
          className={styles.profilePillXpFill}
          style={{width: `${Math.max(0, Math.min(100, progression.progressPercent))}%`}}>
          <span
            aria-hidden="true"
            className={styles.profilePillXpFillBubbles}/>
        </div>
        <div className={styles.profilePillXpText}>
          <span>{progression.xpBarLabel}</span>
        </div>
      </div>
    </div>
  </Link>)
}
