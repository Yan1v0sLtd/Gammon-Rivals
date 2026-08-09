export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string, checked: boolean, onChange(value: boolean): void,
}) {
  return (<label
    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm font-bold text-white/70">
    {label}
    <input
      checked={checked}
      className="h-4 w-4 accent-amber-300"
      type="checkbox"
      onChange={(event) => {
        onChange(event.target.checked)
      }}/>
  </label>)
}
