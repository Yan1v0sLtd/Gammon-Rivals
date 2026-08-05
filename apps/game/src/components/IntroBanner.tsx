import {memo} from "react"

import styles from "./IntroBanner.module.css"

export type IntroBannerProps = {
  title: string,
  subtitle: string,
  onDismiss: () => void,
}

export const IntroBanner = memo(function IntroBanner({title, subtitle, onDismiss}: IntroBannerProps) {
  return (
    <button
      className={styles.button}
      type="button"
      onClick={onDismiss}>
      <div className={styles.title}>{title}</div>
      <div className={styles.subtitle}>{subtitle}</div>
      <div className={styles.dismissHint}>Tap to dismiss</div>
    </button>
  )
})
