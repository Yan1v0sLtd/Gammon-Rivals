import {useEffect, useState} from "react"

import styles from "./SaleCountdown.module.css"

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
  return (<div className={styles.footer}>
    <span className={styles.label}>Sale ends in</span>
    <span className={styles.timer}>
      {formatCountdown(remaining)}
    </span>
  </div>)
}
