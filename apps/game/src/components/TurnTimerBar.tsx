import {useEffect, useState, type CSSProperties} from "react"

type Props = {
  readonly deadlineMs: number,
  readonly durationMs: number,
  readonly compact?: boolean,
  readonly side?: "left" | "right",
}

export function TurnTimerBar({
  deadlineMs,
  durationMs,
  compact = false,
  side = "left",
}: Props) {
  const [now, setNow] = useState(() => Date.now())
  const validDeadline = Number.isFinite(deadlineMs)
  const validDuration = Number.isFinite(durationMs) && durationMs > 0

  useEffect(() => {
    if (!validDeadline || !validDuration) return
    setNow(Date.now())
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 220)
    return () => {
      window.clearInterval(id)
    }
  }, [deadlineMs, durationMs, validDeadline, validDuration])

  const remainingMs = validDeadline ? Math.max(0, deadlineMs - now) : 0
  const secondsLeft = Math.ceil(remainingMs / 1000)
  const progress = validDeadline && validDuration ? remainingMs / durationMs : 0
  const clamped = Math.max(0, Math.min(1, progress))
  const tone = clamped > 0.34 ? "is-safe" : clamped > 0.16 ? "is-warning" : "is-danger"
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, "0")
  const timerStyle = {"--timer-progress": clamped} as CSSProperties

  return (<div className={`game-turn-timer game-turn-timer--${side} ${compact ? "is-compact" : ""} ${tone}`}>
    <div
      aria-label={`${secondsLeft} seconds left`}
      className="game-turn-timer-track"
      style={timerStyle}>
      <div className="game-turn-timer-fill"/>
    </div>
    <strong>{minutes}:{seconds}</strong>
  </div>)
}
