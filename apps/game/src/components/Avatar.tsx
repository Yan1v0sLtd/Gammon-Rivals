import {avatarUrl} from "../lib/identity"

import styles from "./Avatar.module.css"

type Props = {
  /** The seed used to deterministically generate the avatar. */
  seed: string,
  /** Optional account avatar image, such as a Google profile photo. */
  imageUrl?: string | null,
  /** Pixel size of the rendered circle. Defaults to 64. */
  size?: number,
  /** Optional ring colour for the active player. */
  ring?: "active" | "idle" | "none",
  /** Optional small badge — country flag, AI pill, etc. */
  badge?: React.ReactNode,
  className?: string,
}

const RING_CLASS: Record<NonNullable<Props["ring"]>, string> = {
  active: styles.ringActive,
  idle: styles.ringIdle,
  none: styles.ringNone,
}

/**
 * Round avatar rendered from a DiceBear seed. Loads the SVG from the
 * DiceBear API directly — no proxy or local image needed. The avatar
 * itself is generated; we layer a coloured ring + optional badge on top.
 */
export function Avatar({
  seed,
  imageUrl,
  size = 64,
  ring = "idle",
  badge,
  className = "",
}: Props) {
  const ringClass = RING_CLASS[ring]
  return (<div
    className={`${styles.wrap} ${className}`}
    style={{
      width: size,
      height: size,
    }}>
    <img
      alt=""
      className={`${styles.image} ${ringClass}`}
      draggable={false}
      height={size}
      loading="lazy"
      src={imageUrl ?? avatarUrl(seed, size * 2)}
      width={size}/>
    {badge !== undefined && (<span
      className={styles.badge}>
      {badge}
    </span>)}
  </div>)
}
