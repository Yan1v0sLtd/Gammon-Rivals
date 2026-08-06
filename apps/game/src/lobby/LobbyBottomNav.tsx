import {useEffect, useState} from "react"

import type {LobbyFeatureConfigMap} from "../features/lobby/lobbyData"
import type {WheelStateResult} from "../lib/useWheelState"

import {HourlyBonusWidget} from "./HourlyBonusWidget"
import styles from "./LobbyBottomNav.module.css"
import {lobbyNavItems} from "./lobbyData"

type Props = {
  readonly wheel: WheelStateResult,
  readonly onClaimWheel: () => void,
  readonly onOpenMissions?: () => void,
  /** Badge count for the Missions slot (claimable + unclaimed). */
  readonly missionsBadge?: number,
  /** Per-feature unlock levels (by feature_key). Empty = nothing gated. */
  readonly featureConfigs: LobbyFeatureConfigMap,
  /** Current player level, compared against each feature's unlock level. */
  readonly playerLevel: number,
}

/**
 * Wood-bar navigator at the bottom of the lobby. Four side slots render their
 * pre-rendered icon+label .webp; the middle slot hosts the hourly-bonus wheel
 * (never level-gated — it's a core free reward).
 *
 * A level-locked feature dims its icon and overlays a bare gold padlock (no
 * circular badge). Tapping the lock wiggles it and pops a gold-rimmed tooltip
 * ABOVE it ("Reach level N to unlock") with a downward pointer and a jelly
 * stretch. The tooltip TEXT matches the board carousel pill's font. The open
 * lock is parent-controlled and collapses on an outside tap.
 */
export function LobbyBottomNav({
  wheel,
  onClaimWheel,
  onOpenMissions,
  missionsBadge,
  featureConfigs,
  playerLevel,
}: Props) {
  // Which locked slot's pill is expanded (feature_key), or null.
  const [openLockKey, setOpenLockKey] = useState<string | null>(null)

  // Collapse the expanded pill as soon as the player taps anywhere else. The
  // listener is armed on the next tick so the tap that opened it doesn't
  // immediately close it. (UnlockPill stops propagation on its own taps, so
  // tapping the lock itself never reaches this.)
  useEffect(() => {
    if (!openLockKey) return
    const close = () => {
      setOpenLockKey(null)
    }
    const armId = window.setTimeout(() => {
      window.addEventListener("pointerdown", close)
    }, 0)
    return () => {
      window.clearTimeout(armId)
      window.removeEventListener("pointerdown", close)
    }
  }, [openLockKey])

  return (<nav
    aria-label="Lobby sections"
    className={styles.bottomNavShell}>
    <div
      aria-hidden="true"
      className={styles.bottomNavBar}/>
    <div className={styles.bottomNavRow}>
      {lobbyNavItems.map((item) => {
        if (item.id === "placeholder") {
          return (<div
            key={item.id}
            className={`${styles.bottomNavSlot} ${styles.bottomNavSlotHourly}`}>
            <HourlyBonusWidget
              result={wheel}
              onClaim={onClaimWheel}/>
          </div>)
        }
        const cfg = featureConfigs[item.id]
        const locked = cfg ? playerLevel < cfg.unlockLevel : false

        // Locked slot: NOT a <button> (the padlock itself is the interactive
        // button — a button-in-button would be invalid). Dimmed icon + the
        // bare padlock + its pop-above tooltip.
        if (locked && item.image) {
          return (<div
            key={item.id}
            className={`${styles.bottomNavSlot} ${styles.isLocked}`}>
            <img
              alt=""
              className={styles.navItemImage}
              draggable={false}
              src={item.image}/>
            <NavFeatureLock
              gradientId={`navlock-${item.id}`}
              label={item.label}
              level={cfg.unlockLevel}
              open={openLockKey === item.id}
              text={cfg.tooltipText}
              onToggle={() => {
                setOpenLockKey((k) => (k === item.id ? null : item.id))
              }}/>
          </div>)
        }

        const isMissions = item.id === "missions"
        const onClick = isMissions ? onOpenMissions : undefined
        const badge = isMissions && missionsBadge && missionsBadge > 0 ? String(missionsBadge) : item.badge
        return item.image ? (<button
          key={item.id}
          aria-label={item.label}
          className={styles.bottomNavSlot}
          type="button"
          onClick={onClick}>
          <img
            alt=""
            className={styles.navItemImage}
            draggable={false}
            src={item.image}/>
          {badge ? <span className={styles.navBadge}>{badge}</span> : null}
        </button>) : (<span
          key={item.id}
          aria-hidden="true"
          className={`${styles.bottomNavSlot} ${styles.isPlaceholder}`}/>)
      })}
    </div>
  </nav>)
}

type NavFeatureLockProps = {
  readonly level: number,
  readonly label: string,
  /** Operator override; blank/null falls back to "Reach level N to unlock". */
  readonly text: string | null,
  /** Unique <linearGradient> id so multiple locks don't collide. */
  readonly gradientId: string,
  readonly open: boolean,
  readonly onToggle: () => void,
}

/**
 * Bare gold padlock overlaid on a locked feature slot (no circular badge).
 * Tapping wiggles the lock and pops a gold-rimmed tooltip above it; tapping
 * again (or anywhere outside) collapses it. The pill auto-sizes to its text,
 * which the operator can override per feature (e.g. "Coming soon") — otherwise
 * it shows "Reach level N to unlock". The font matches the board carousel
 * pill. All of the motion is CSS — see the .navLock* rules in LobbyBottomNav.module.css.
 */
function NavFeatureLock({
  level,
  label,
  text,
  gradientId,
  open,
  onToggle,
}: NavFeatureLockProps) {
  const tipText = text?.trim() ? text.trim() : `Reach level ${level} to unlock`
  return (<div className={`${styles.navLockWrap} ${open ? styles.isOpen : ""}`}>
    <button
      aria-label={open ? tipText : `${label} locked`}
      className={styles.navLock}
      type="button"
      // Stop the tap that opens/toggles the lock from reaching the
      // window-level outside-tap listener that closes it.
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
      }}>
      <svg
        aria-hidden="true"
        className={styles.navLockIcon}
        viewBox="0 0 24 24">
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            x2="0"
            y1="0"
            y2="1">
            <stop
              offset="0%"
              stopColor="#fff2a2"/>
            <stop
              offset="45%"
              stopColor="#f3c14c"/>
            <stop
              offset="100%"
              stopColor="#b97918"/>
          </linearGradient>
        </defs>
        <path
          d="M12 1.5a5 5 0 0 0-5 5V10H6.5A2.5 2.5 0 0 0 4 12.5v8A2.5 2.5 0 0 0 6.5 23h11a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 17.5 10H17V6.5a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3V10H9V6.5a3 3 0 0 1 3-3zm0 11a2 2 0 0 1 .8 3.83V20.5a.8.8 0 0 1-1.6 0v-2.17A2 2 0 0 1 12 14.5z"
          fill={`url(#${gradientId})`}/>
      </svg>
    </button>
    <div
      aria-hidden={!open}
      className={styles.navLockTip}>
      <span>{tipText}</span>
    </div>
  </div>)
}
