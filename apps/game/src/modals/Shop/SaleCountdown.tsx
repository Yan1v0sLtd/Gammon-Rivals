import {useEffect, useState} from "react"

// Total remaining time as HH:MM:SS, where HH is the *total* hours (can exceed
// 24 — a 2-day sale shows "48:00:00"), matching the requested format.
function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000))
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

// Ticks once a second toward the sale's end. Renders nothing once elapsed (or if
// endsAt is unparseable), so a finished sale simply drops the footer.
export function SaleCountdown({endsAt}: {endsAt: string}) {
  const target = new Date(endsAt).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [])
  const remaining = target - now
  if (!Number.isFinite(target) || remaining <= 0) return null
  return (<div
    className="relative z-[3] flex items-center justify-center gap-2.5 border-t border-[#ffc93d]/25 bg-gradient-to-b from-[#0c1c37]/10 to-[#050d1c]/45 px-10 py-3">
    <span
      className="font-display text-[0.95rem] font-bold uppercase tracking-[0.14em] text-[#f6e6b8]/75">Sale ends in</span>
    <span
      className="font-display text-xl font-black tabular-nums tracking-[0.1em] text-[#ffc93d] drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]">
      {formatCountdown(remaining)}
    </span>
  </div>)
}
