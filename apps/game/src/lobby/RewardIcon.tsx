import type {RewardItem} from "../features/lobby/lobbyData"

import {hideImg} from "./missionHelpers"
import styles from "./RewardIcon.module.css"

function XpHex({size}: {readonly size: "md" | "lg"}) {
  const h = size === "lg" ? 48 : 38
  return (
    <svg
      aria-hidden="true"
      className={styles.xpHex}
      style={{height: h}}
      viewBox="0 0 100 110">
      <defs>
        <linearGradient
          id="dm-xp-fill"
          x1="0"
          x2="0"
          y1="0"
          y2="1">
          <stop
            offset="0%"
            stopColor="#a855f7"/>
          <stop
            offset="100%"
            stopColor="#581c87"/>
        </linearGradient>
        <linearGradient
          id="dm-xp-rim"
          x1="0"
          x2="0"
          y1="0"
          y2="1">
          <stop
            offset="0%"
            stopColor="#fcd34d"/>
          <stop
            offset="100%"
            stopColor="#b45309"/>
        </linearGradient>
      </defs>
      <polygon
        fill="url(#dm-xp-rim)"
        points="50,3 96,28 96,82 50,107 4,82 4,28"/>
      <polygon
        fill="url(#dm-xp-fill)"
        points="50,11 88,33 88,77 50,99 12,77 12,33"/>
      <text
        fill="white"
        fontFamily="system-ui, sans-serif"
        fontSize="34"
        fontWeight="900"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
        textAnchor="middle"
        x="50"
        y="68">XP
      </text>
    </svg>
  )
}

export function RewardIcon({
  reward,
  size,
}: {readonly reward: RewardItem, readonly size: "md" | "lg"}) {
  const cls = size === "lg" ? `${styles.rewardIcon} ${styles.rewardIconLg}` : styles.rewardIcon
  if (reward.reward_kind === "currency") {
    if (reward.currency_code === "xp") return <XpHex size={size}/>
    const src = reward.currency_code === "coins" ? "/lobby/icons/gold-coin.webp" : reward.currency_code === "gems" ? "/lobby/icons/gem.webp" : null
    if (src) return (<img
      alt=""
      className={cls}
      draggable={false}
      src={src}
      onError={hideImg}/>)
  }
  return <div className={`${styles.xpToken} ${cls}`}>?</div>
}
