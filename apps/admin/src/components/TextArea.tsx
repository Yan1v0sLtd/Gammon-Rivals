import styles from "./TextArea.module.css"

export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string,
  value: string,
  onChange(value: string): void,
  rows?: number,
}) {
  return (<label className={styles.fieldLabel}>
    {label}
    <textarea
      className={styles.fieldInput}
      rows={rows}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}/>
  </label>)
}
