import {useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useRefreshPlayerMissionsMutation} from "./DailyMissionsApi"

/** Testing helper: refresh a real player's daily missions on demand. */
export function RefreshMissionsTool({canManage}: {readonly canManage: boolean}) {
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-950/20 px-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-amber-200/80">Testing · Refresh missions</span>
      <input
        className="min-w-[200px] flex-1 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
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
        className="rounded bg-amber-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-50"
        disabled={busy || !email.trim()}
        type="button"
        onClick={run}>
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {msg && <span className="text-xs text-emerald-300">{msg}</span>}
      {err && <span className="text-xs text-rose-300">{err}</span>}
    </div>)
}
