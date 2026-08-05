import styles from "./LobbyActionCard.module.css"

type LobbyActionCardProps = {
  readonly title: string,
  readonly subtitle: string,
  readonly tone: "blue" | "green" | "purple",
  readonly iconSrc?: string,
  readonly compactIcon?: string,
  readonly disabled?: boolean,
  readonly onClick?: () => void,
}

const toneClass = {
  blue: styles.toneBlue,
  green: styles.toneGreen,
  purple: styles.tonePurple,
} as const

export function LobbyActionCard({
  title,
  subtitle,
  tone,
  iconSrc,
  compactIcon,
  disabled = false,
  onClick,
}: LobbyActionCardProps) {
  return (<button
    className={`${styles.actionCard} ${toneClass[tone]}`}
    disabled={disabled}
    type="button"
    onClick={onClick}>
    <span className={styles.actionGlare}/>
    <span className={styles.actionIcon}>
      {iconSrc ? (<img
        alt=""
        draggable={false}
        src={iconSrc}/>) : (<span>
        {compactIcon}
      </span>)}
    </span>
    <span className={styles.actionBody}>
      <span className={styles.actionTitle}>
        {title}
      </span>
      <span className={styles.actionSubtitle}>{subtitle}</span>
    </span>
    <span className={styles.actionChevron}>
      ›
    </span>
  </button>)
}
