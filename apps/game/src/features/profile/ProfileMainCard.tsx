import {useState} from "react"

import {Avatar} from "../../components/Avatar"
import {formatCompactNumber} from "../../lib/format"
import {useAppSelector} from "../../store/hooks"
import {selectAuthUserId, selectCurrentProfile, selectProfileProgression} from "../auth/authSelectors"
import {useUpdateDisplayNameMutation} from "../playerData/playerDataApi"

import styles from "./ProfileMainCard.module.css"

export function ProfileMainCard() {
  const userId = useAppSelector(selectAuthUserId)
  const profile = useAppSelector(selectCurrentProfile)
  const progression = useAppSelector(selectProfileProgression)
  const [updateDisplayName] = useUpdateDisplayNameMutation()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [savingName, setSavingName] = useState(false)

  const startEditName = () => {
    setDraftName(profile?.display_name ?? "")
    setEditing(true)
  }

  const saveName = async () => {
    setSavingName(true)
    try {
      if (!userId) return
      await updateDisplayName({userId, name: draftName}).unwrap()
      setEditing(false)
    }
    catch (err) {
      console.warn("saveName failed", err)
    }
    finally {
      setSavingName(false)
    }
  }

  // Same source the lobby card uses, so the two XP bars can't drift.
  const xpText = progression.xpBarLabel
  const nextLevelLabel = progression.nextLevelXp ? progression.level + 1 : progression.level

  return (<section className={styles.profileMainCard}>
    <div className={styles.profileAvatarStage}>
      <div className={styles.profileAvatarGlow}/>
      <Avatar
        className={styles.profileAvatarImage}
        imageUrl={profile?.avatar_url}
        ring="none"
        seed={profile?.avatar_seed ?? "profile"}
        size={220}/>
      {/* Same rounded shield shape as the lobby profile card
          * (.lobby-pp-shield), scaled up + anchored to the
          * bottom-centre of the avatar circle via .profile-pp-shield. */}
      <div className={styles.profilePpShield}>
        <span>{progression.level}</span>
      </div>
    </div>

    <div className={styles.profileInfoColumn}>
      {editing ? (<div className={styles.profileNameEditor}>
        <input
          autoFocus
          className={styles.profileNameInput}
          maxLength={32}
          value={draftName}
          onChange={(e) => {
            setDraftName(e.target.value)
          }}/>
        <button
          className={styles.profileSmallAction}
          disabled={savingName || draftName.trim().length === 0}
          type="button"
          onClick={() => void saveName()}>
          Save
        </button>
        <button
          className={`${styles.profileSmallAction} ${styles.profileSmallActionGhost}`}
          type="button"
          onClick={() => {
            setEditing(false)
          }}>
          Cancel
        </button>
      </div>) : (<div className={styles.profileNameRow}>
        <h1>{profile?.display_name ?? "Player"}</h1>
        <button
          aria-label="Edit name"
          className={styles.profileEditButton}
          type="button"
          onClick={startEditName}>
          <span/>
        </button>
      </div>)}

      <div className={styles.profileRankRow}>
        <span className={styles.profileRankBadge}>
          <span
            aria-hidden="true"
            className={styles.profileRankShield}>
            <span/>
          </span>
          <span>{progression.statusLabel}</span>
        </span>
        <span className={styles.profileRating}>
          <span
            aria-hidden="true"
            className={styles.profileRatingCup}/>
          Rating <strong>{formatCompactNumber(profile?.rating ?? 1500)}</strong>
        </span>
      </div>

      <div className={styles.profileXpSection}>
        <div className={styles.profileLevelRow}>
          <span>Level {progression.level}</span>
          <span>Level {nextLevelLabel}</span>
        </div>
        {/* Lobby lava-XP bar — the module-local xpBar (migrated from
            * .lobby-profile-progress) with the xpBarWide widening modifier
            * (orange→yellow gradient with animated bubble layers riding
            * the filled portion). */}
        <div className={styles.profileXpRow}>
          <span
            aria-label={`XP progress ${progression.progressLabel}`}
            className={`${styles.xpBar} ${styles.xpBarWide}`}>
            <span
              className={styles.xpBarFill}
              style={{width: `${progression.progressPercent}%`}}>
              <span
                aria-hidden="true"
                className={styles.xpBarBubbles}/>
            </span>
            <span className={styles.xpBarLabel}>{xpText}</span>
          </span>
        </div>
        <div className={styles.profileNextReward}>
          <span>Next Reward:</span>
          <img
            alt=""
            draggable={false}
            src="/lobby/icons/gold-coin.webp"/>
          <strong>500 Coins</strong>
        </div>
      </div>
    </div>
  </section>)
}
