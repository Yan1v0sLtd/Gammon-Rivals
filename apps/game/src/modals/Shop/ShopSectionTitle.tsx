import type {ReactNode} from "react"

import styles from "./ShopSectionTitle.module.css"

export function SectionTitle({
  children,
  compact = false,
}: {children: ReactNode, compact?: boolean}) {
  // `compact` shrinks the title (smaller font + tighter tracking + no-wrap) so a
  // long label like "Featured Pack" stays on one line in the narrow column. The
  // fixed height keeps both section titles the same height even at different font
  // sizes, so the bundle and the packs grid below them start (and end) level.
  return (<h2 className={`${styles.sectionTitle} ${compact ? styles.compact : styles.large}`}>
    <span className={compact ? styles.starSmall : styles.starLarge}>✦</span>
    {children}
    <span className={compact ? styles.starSmall : styles.starLarge}>✦</span>
  </h2>)
}
