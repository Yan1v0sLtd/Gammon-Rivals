import styles from "./EmptyState.module.css"

export function EmptyState({text}: {
  text: string,
}) {
  return (<div className={styles.emptyState}>
    {text}
  </div>)
}
