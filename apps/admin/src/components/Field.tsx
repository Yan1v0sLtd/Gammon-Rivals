import styles from "./Field.module.css"

export function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  placeholder,
}: {
  label: string,
  value: string,
  onChange(value: string): void,
  type?: string,
  disabled?: boolean,
  placeholder?: string,
}) {
  // Date/time inputs get the native calendar/clock picker: dark color-scheme so
  // the indicator + popup are legible on the dark UI, and a click anywhere in
  // the field opens it (showPicker) so the operator never has to type a date.
  const isPicker = type === "date" || type === "datetime-local" || type === "time" || type === "month" || type === "week"
  return (<label className={styles.fieldLabel}>
    {label}
    <input
      className={`${styles.fieldInput}${isPicker ? ` ${styles.picker}` : ""}`}
      disabled={disabled}
      placeholder={placeholder}
      type={type}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      onClick={isPicker ? (event) => {
        try {
          (event.currentTarget).showPicker?.()
        }
        catch {
          /* showPicker unsupported / not user-activated — typing still works */
        }
      } : undefined}/>
  </label>)
}
