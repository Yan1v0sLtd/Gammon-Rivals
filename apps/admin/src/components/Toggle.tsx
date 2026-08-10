import styles from "./Toggle.module.css"

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string,
  checked: boolean,
  onChange(value: boolean): void,
}) {
  return (<label
    className={styles.toggleRow}>
    {label}
    <input
      checked={checked}
      className={styles.checkbox}
      type="checkbox"
      onChange={(event) => {
        onChange(event.target.checked)
      }}/>
  </label>)
}
