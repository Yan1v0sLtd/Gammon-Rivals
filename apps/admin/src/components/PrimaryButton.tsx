import type {ReactNode} from "react"

import styles from "./PrimaryButton.module.css"

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode,
  onClick(): void,
  disabled?: boolean,
}) {
  return (<button
    className={styles.primaryButton}
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
