export function StatusPill({enabled}: {enabled: boolean}) {
  return (<span
    className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${enabled ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30" : "bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/30"}`}>
    {enabled ? "Enabled" : "Disabled"}
  </span>)
}
