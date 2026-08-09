export function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  placeholder,
}: {
  label: string, value: string, onChange(value: string): void, type?: string, disabled?: boolean, placeholder?: string,
}) {
  // Date/time inputs get the native calendar/clock picker: dark color-scheme so
  // the indicator + popup are legible on the dark UI, and a click anywhere in
  // the field opens it (showPicker) so the operator never has to type a date.
  const isPicker = type === "date" || type === "datetime-local" || type === "time" || type === "month" || type === "week"
  return (<label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
    {label}
    <input
      className={`mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50${isPicker ? " cursor-pointer [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer" : ""}`}
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
