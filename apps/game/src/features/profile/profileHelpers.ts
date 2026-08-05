import styles from "../../pages/Profile.module.css"
import type {MatchSummary} from "../playerData/matchHistoryData"

export const MODE_LABEL: Record<string, string> = {
  hotseat: "Hot-seat",
  "ai-easy": "AI - Easy",
  "ai-medium": "AI - Medium",
  "ai-hard": "AI - Hard",
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    return String((err).message)
  }
  return String(err)
}

export function ownerOutcome(m: MatchSummary): "won" | "lost" | "open" | "hotseat" {
  if (!m.finished_at) return "open"
  if (m.mode === "hotseat") return "hotseat"
  return m.winner === "white" ? "won" : "lost"
}

export function modeIcon(mode: string): "hotseat" | "online" | "ai" {
  if (mode === "hotseat") return "hotseat"
  if (mode.startsWith("ai-")) return "ai"
  return "online"
}

export const MATCH_ICON_CLASS: Record<ReturnType<typeof modeIcon>, string> = {
  hotseat: styles.profileMatchIconHotseat,
  online: styles.profileMatchIconOnline,
  ai: styles.profileMatchIconAi,
}

export const HISTORY_OUTCOME_CLASS: Record<ReturnType<typeof ownerOutcome>, string> = {
  won: styles.profileHistoryStatusWon,
  lost: styles.profileHistoryStatusLost,
  open: styles.profileHistoryStatusOpen,
  hotseat: styles.profileHistoryStatusHotseat,
}
