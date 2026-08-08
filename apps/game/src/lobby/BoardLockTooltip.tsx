import {useEffect} from "react"

import styles from "./BoardLockTooltip.module.css"

type BoardLockTooltipProps = {
  readonly requiredLevel: number,
  readonly onDismiss: () => void,
}

export function BoardLockTooltip({
  requiredLevel,
  onDismiss,
}: BoardLockTooltipProps) {
  useEffect(() => {
    const timeout = window.setTimeout(onDismiss, 3000)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [onDismiss])

  return (<div className={styles.overlay}>
    <div className={styles.tooltip}>
      Reach level {requiredLevel} to unlock
    </div>
  </div>)
}
