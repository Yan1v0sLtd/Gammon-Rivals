import type {ReactNode} from "react"

import styles from "./DangerButton.module.css"

export function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode,
  onClick(): void,
  disabled?: boolean,
}) {
  return (<button
    className={styles.dangerButton}
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
