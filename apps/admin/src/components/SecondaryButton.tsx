import type {ReactNode} from "react"

import styles from "./SecondaryButton.module.css"

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode,
  onClick(): void,
  disabled?: boolean,
}) {
  return (<button
    className={styles.secondaryButton}
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
