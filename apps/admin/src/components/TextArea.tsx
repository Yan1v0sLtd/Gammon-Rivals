export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string, value: string, onChange(value: string): void, rows?: number,
}) {
  return (<label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
    {label}
    <textarea
      className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60"
      rows={rows}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}/>
  </label>)
}
