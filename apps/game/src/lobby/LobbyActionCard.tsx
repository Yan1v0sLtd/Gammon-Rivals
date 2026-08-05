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
  blue: "from-[#064476] via-[#075f9d] to-[#042d5a] border-[#3ca5ee]",
  green: "from-[#0b672e] via-[#148c39] to-[#074e26] border-[#56d66a]",
  purple: "from-[#4f167c] via-[#6821ad] to-[#341153] border-[#b64df6]",
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
    className={`${styles.actionCard} group relative flex min-h-[7.1rem] w-full items-center gap-3 overflow-hidden rounded-xl border-2 bg-gradient-to-br p-4 text-left shadow-[0_10px_22px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-110 active:translate-y-1 disabled:cursor-default disabled:opacity-65 ${toneClass[tone]}`}
    disabled={disabled}
    type="button"
    onClick={onClick}>
    <span className="absolute inset-x-0 top-0 h-1/2 bg-white/10"/>
    <span className={`${styles.actionIcon} relative grid h-20 w-20 shrink-0 place-items-center`}>
      {iconSrc ? (<img
        alt=""
        className="max-h-24 max-w-24 object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.35)]"
        draggable={false}
        src={iconSrc}/>) : (<span
        className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#f5d873] bg-gradient-to-b from-[#ffe87b] to-[#b36b12] text-3xl font-black text-[#2a1609] shadow-[0_7px_0_rgba(0,0,0,0.28)]">
        {compactIcon}
      </span>)}
    </span>
    <span className={`${styles.actionBody} relative min-w-0 flex-1`}>
      <span
        className={`${styles.actionTitle} block font-display text-[1.45rem] font-black uppercase leading-[0.95] text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.34)] 2xl:text-2xl`}>
        {title}
      </span>
      <span
        className={`${styles.actionSubtitle} mt-2 block text-sm font-semibold leading-snug text-white/78`}>{subtitle}</span>
    </span>
    <span className={`${styles.actionChevron} relative text-4xl font-black text-[#ffe3a0] drop-shadow-[0_2px_0_rgba(0,0,0,0.45)]`}>
      ›
    </span>
  </button>)
}
