// Shop currency icons — one renderer for every place that needs them (cards,
// price button, hero fallback). Sub-renders are private; only the kind-based
// entry point is public.

import styles from "./ShopIcon.module.css"

export type ShopIconKind = "coins" | "gems" | "xp" | "dice"

function GemIcon({className = ""}: {className?: string}) {
  return (<img
    alt=""
    className={`${styles.icon} ${className}`}
    draggable={false}
    src="/lobby/carousel/gem.webp"/>)
}

function CoinIcon({className = ""}: {className?: string}) {
  return (<img
    alt=""
    className={`${styles.icon} ${className}`}
    draggable={false}
    src="/lobby/icons/gold-coin.webp"/>)
}

function XpBadge({className = ""}: {className?: string}) {
  return (<svg
    aria-hidden="true"
    className={`${styles.vectorIcon} ${className}`}
    viewBox="0 0 100 110">
    <defs>
      <linearGradient
        id="shop-xp-fill"
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
        id="shop-xp-rim"
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
      fill="url(#shop-xp-rim)"
      points="50,3 96,28 96,82 50,107 4,82 4,28"/>
    <polygon
      fill="url(#shop-xp-fill)"
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
  </svg>)
}

function DiceIcon({className = ""}: {className?: string}) {
  return (<svg
    aria-hidden="true"
    className={`${styles.vectorIcon} ${className}`}
    viewBox="0 0 100 80">
    <defs>
      <linearGradient
        id="shop-dice-fill"
        x1="0"
        x2="0"
        y1="0"
        y2="1">
        <stop
          offset="0%"
          stopColor="#fef9c3"/>
        <stop
          offset="100%"
          stopColor="#e7d09a"/>
      </linearGradient>
    </defs>
    <rect
      fill="url(#shop-dice-fill)"
      height="42"
      rx="6"
      stroke="#3a1f08"
      strokeWidth="2"
      width="42"
      x="42"
      y="6"/>
    <circle
      cx="63"
      cy="27"
      fill="#3a1f08"
      r="3"/>
    <rect
      fill="url(#shop-dice-fill)"
      height="46"
      rx="6"
      stroke="#3a1f08"
      strokeWidth="2"
      width="46"
      x="14"
      y="28"/>
    <circle
      cx="25"
      cy="40"
      fill="#3a1f08"
      r="3"/>
    <circle
      cx="49"
      cy="40"
      fill="#3a1f08"
      r="3"/>
    <circle
      cx="37"
      cy="51"
      fill="#3a1f08"
      r="3"/>
    <circle
      cx="25"
      cy="62"
      fill="#3a1f08"
      r="3"/>
    <circle
      cx="49"
      cy="62"
      fill="#3a1f08"
      r="3"/>
  </svg>)
}

export function ShopIcon({
  kind,
  className,
}: {kind: ShopIconKind, className: string}) {
  if (kind === "coins") return <CoinIcon className={className}/>
  if (kind === "gems") return <GemIcon className={className}/>
  if (kind === "xp") return <XpBadge className={className}/>
  return <DiceIcon className={className}/>
}
