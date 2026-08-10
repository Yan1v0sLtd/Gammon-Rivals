import {useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useRefreshPlayerMissionsMutation} from "./DailyMissionsApi"
import styles from "./RefreshMissionsTool.module.css"

/** Testing helper: refresh a real player's daily missions on demand. */
export function RefreshMissionsTool({canManage}: {
  readonly canManage: boolean,
}) {
  const [refreshPlayerMissions] = useRefreshPlayerMissionsMutation()

  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (!canManage) return null

  const run = async () => {
    const e = email.trim()
    if (!e || busy) return
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const d = await refreshPlayerMissions(e).unwrap()
      setMsg(`Refreshed — cleared ${d.deleted ?? 0}, assigned ${d.assigned ?? 0} daily mission(s). Reload the player's lobby.`)
    }
    catch (ex) {
      setErr(extractErrorMessage(ex))
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.toolbar}>
      <span className={styles.toolbarLabel}>Testing · Refresh missions</span>
      <input
        className={styles.emailInput}
        placeholder="player email"
        type="email"
        value={email}
        onChange={(ev) => {
          setEmail(ev.target.value)
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") run()
        }}/>
      <button
        className={styles.refreshButton}
        disabled={busy || !email.trim()}
        type="button"
        onClick={run}>
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {msg && <span className={styles.msg}>{msg}</span>}
      {err && <span className={styles.err}>{err}</span>}
    </div>)
}
