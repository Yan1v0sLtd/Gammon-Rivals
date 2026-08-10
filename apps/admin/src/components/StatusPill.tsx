import styles from "./StatusPill.module.css"

export function StatusPill({enabled}: {
  enabled: boolean,
}) {
  return (<span
    className={`${styles.statusPill} ${enabled ? styles.enabled : styles.disabled}`}>
    {enabled ? "Enabled" : "Disabled"}
  </span>)
}
