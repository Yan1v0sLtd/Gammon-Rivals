import {useEffect, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"
import {useConfirm} from "../../components/useConfirm.tsx"

import {
  useAssignSimDailyMissionsMutation,
  useCleanupSimAllMutation,
  useCreateSimTestProfileMutation,
  useGetSimTestProfilesQuery,
  useGetSimTestUserStateQuery,
  useResetSimTodayMissionsMutation,
  useSetSimMetricMutation,
  useSpawnSimArchetypesMutation,
} from "./DailyMissionsApi"

/** Metrics the operator can author baselines for. The Phase 4
 *  triggers feed these for real users; for synthetic users we
 *  set them directly. */
const KNOWN_METRICS = ["matches_per_day", "coins_wagered_per_day", "coins_won_net_per_day", "xp_per_day", "gems_spent_per_day", "wheel_spins_per_day", "ranked_wins_per_week", "win_streak", "levels_per_week"]

export function SimulatorTab({canManage}: {readonly canManage: boolean}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    data: profiles = [],
    error: profilesError,
  } = useGetSimTestProfilesQuery()
  // The detail pane is keyed by the selected profile, so the state query is
  // skipped entirely until one is picked (skipToken keeps the argument typed
  // as a string instead of forcing a placeholder cache key).
  const {
    data: state,
    error: stateError,
  } = useGetSimTestUserStateQuery(selectedId ?? skipToken)

  const [createSimTestProfile] = useCreateSimTestProfileMutation()
  const [setSimMetric] = useSetSimMetricMutation()
  const [resetSimTodayMissions] = useResetSimTodayMissionsMutation()
  const [assignSimDailyMissions] = useAssignSimDailyMissionsMutation()
  const [spawnSimArchetypes] = useSpawnSimArchetypesMutation()
  const [cleanupSimAll] = useCleanupSimAllMutation()

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const {
    confirm,
    confirmUI,
  } = useConfirm()

  // New-profile form
  const [newName, setNewName] = useState("")
  const [newLevel, setNewLevel] = useState(10)
  const [newRating, setNewRating] = useState(1200)

  // Archetype-spawn form
  const [casuals, setCasuals] = useState(5)
  const [regulars, setRegulars] = useState(5)
  const [whales, setWhales] = useState(3)

  // Query failures surface through the same inline error the actions use.
  useEffect(() => {
    if (profilesError) setError(profilesError.message ?? "Failed to load test profiles.")
  }, [profilesError])
  useEffect(() => {
    if (stateError) setError(stateError.message ?? "Failed to load test user state.")
  }, [stateError])

  // Every simulator mutation invalidates the DailyMissions tag, so the
  // profile list and the selected profile's state refetch on their own.
  const createProfile = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const id = await createSimTestProfile({
        displayName: newName.trim(),
        level: newLevel,
        pvpRating: newRating,
      }).unwrap()
      setNewName("")
      setSelectedId(id)
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setBusy(false)
    }
  }

  const setMetric = async (metric: string, baseline: number) => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      await setSimMetric({
        profileId: selectedId,
        metricCode: metric,
        baseline,
      }).unwrap()
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setBusy(false)
    }
  }

  const reassign = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      // Reset first, then assign — same order the inline RPC pair used.
      await resetSimTodayMissions(selectedId).unwrap()
      await assignSimDailyMissions(selectedId).unwrap()
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setBusy(false)
    }
  }

  const spawnArchetypes = async () => {
    setBusy(true)
    setError(null)
    try {
      await spawnSimArchetypes({
        casuals,
        regulars,
        whales,
      }).unwrap()
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setBusy(false)
    }
  }

  const cleanupAll = async () => {
    if (!(await confirm({
      title: "Delete all test profiles?",
      message: `Permanently removes all ${profiles.length} synthetic test profiles. This cannot be undone.`,
      confirmLabel: "Delete all",
      tone: "danger",
    }))) return
    setBusy(true)
    setError(null)
    try {
      await cleanupSimAll().unwrap()
      setSelectedId(null)
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setBusy(false)
    }
  }

  return (<div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
    {confirmUI}
    {/* Left column: profile list + new-profile form + bulk spawn */}
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
        <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">Create test user</h4>
        <input
          className="mb-2 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          disabled={!canManage}
          placeholder="display name"
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
          }}/>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-white/60">
            Level
            <input
              className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={newLevel}
              onChange={(e) => {
                setNewLevel(Number(e.target.value))
              }}/>
          </label>
          <label className="text-xs text-white/60">
            pvp_rating
            <input
              className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={newRating}
              onChange={(e) => {
                setNewRating(Number(e.target.value))
              }}/>
          </label>
        </div>
        {canManage && (<button
          className="w-full rounded bg-emerald-600 py-1.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={busy || !newName.trim()}
          type="button"
          onClick={createProfile}>
          + Create
        </button>)}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
        <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">Spawn archetypes (bulk)</h4>
        <div className="mb-2 grid grid-cols-3 gap-2">
          {[{
            label: "Casuals",
            value: casuals,
            set: setCasuals,
          }, {
            label: "Regulars",
            value: regulars,
            set: setRegulars,
          }, {
            label: "Whales",
            value: whales,
            set: setWhales,
          }].map((row) => (<label
            key={row.label}
            className="text-xs text-white/60">
            {row.label}
            <input
              className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={row.value}
              onChange={(e) => {
                row.set(Number(e.target.value))
              }}/>
          </label>))}
        </div>
        {canManage && (<button
          className="w-full rounded bg-amber-600 py-1.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
          disabled={busy}
          type="button"
          onClick={spawnArchetypes}>
          Spawn + assign + recompute
        </button>)}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.045]">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-amber-100/70">Test users ({profiles.length})</span>
          {canManage && profiles.length > 0 && (<button
            className="rounded bg-rose-700/60 px-2 py-0.5 text-xs text-white hover:bg-rose-700"
            disabled={busy}
            type="button"
            onClick={cleanupAll}>
            Delete all
          </button>)}
        </div>
        <div className="max-h-[40vh] overflow-y-auto">
          {profiles.length === 0 ? (
            <div className="p-3 text-sm text-white/40">No synthetic profiles yet.</div>) : (profiles.map((p) => (<button
            key={p.id}
            className={`flex w-full items-center justify-between border-t border-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/[0.04] ${selectedId === p.id ? "bg-amber-500/10" : ""}`}
            type="button"
            onClick={() => {
              setSelectedId(p.id)
            }}>
            <span className="text-white">{p.display_name}</span>
            <span className="text-xs text-white/50">L{p.level} · {p.pvp_rating}</span>
          </button>)))}
        </div>
      </div>
    </div>

    {/* Right column: selected user detail */}
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      {!state ? (<p className="text-sm text-white/50">Select a test user, or create one to begin.</p>) : (<>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-amber-100">{state.profile.display_name}</h3>
            <div className="text-xs text-white/50">
              Level {state.profile.level} · pvp_rating {state.profile.pvp_rating} · {state.profile.xp} XP
            </div>
          </div>
          {canManage && (<button
            className="rounded bg-amber-500 px-3 py-1.5 text-sm font-bold text-amber-950 hover:brightness-110 disabled:opacity-50"
            disabled={busy}
            type="button"
            onClick={reassign}>
            Reset & re-assign
          </button>)}
        </div>

        {/* Metrics editor */}
        <div className="mb-4">
          <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">
            Metric baselines (drives stretch resolution + tier)
          </h4>
          <div className="space-y-1.5">
            {KNOWN_METRICS.map((m) => {
              const row = state.metrics.find((x) => x.metric_code === m)
              return (<MetricRow
                key={m}
                baseline={row?.baseline_7d ?? 0}
                disabled={!canManage || busy}
                metric={m}
                tier={row?.tier ?? null}
                onCommit={(v) => setMetric(m, v)}/>)
            })}
          </div>
        </div>

        {/* Currently-assigned missions */}
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">
            Active missions ({state.missions.length})
          </h4>
          {state.missions.length === 0 ? (
            <p className="text-sm text-white/40">No missions assigned — hit Reset &amp; re-assign.</p>) : (
            <div className="space-y-2">
              {state.missions.map((m) => (<div
                key={m.id}
                className="rounded bg-black/30 p-2 ring-1 ring-white/5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{m.title}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${m.rarity === "epic" ? "bg-fuchsia-700 text-white" : m.rarity === "rare" ? "bg-sky-700 text-white" : "bg-stone-700 text-white"}`}>{m.rarity}{m.period === "weekly" ? " · weekly" : ""}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/60">
                  <span className="font-mono">{m.mission_type}</span>
                  <span>→ goal {m.resolved_goal} ({m.resolution_mode})</span>
                  <span>+{m.mission_points} MP</span>
                  {m.rewards.length > 0 && (<span>
                    {m.rewards.map((r) => (<span
                      key={`${r.amount}-${String(r.currency_code)}`}
                      className="ml-1 rounded bg-white/10 px-1.5 py-0.5">
                      +{r.amount} {r.currency_code}
                    </span>))}
                  </span>)}
                </div>
              </div>))}
            </div>)}
        </div>
      </>)}
      {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
    </div>
  </div>)
}

function MetricRow({
  metric,
  baseline,
  tier,
  disabled,
  onCommit,
}: {
  readonly metric: string,
  readonly baseline: number,
  readonly tier: string | null,
  readonly disabled?: boolean,
  readonly onCommit: (v: number) => void,
}) {
  const [val, setVal] = useState(String(baseline))
  useEffect(() => {
    setVal(String(baseline))
  }, [baseline])
  const tierColor = tier === "whale" ? "bg-fuchsia-700" : tier === "regular" ? "bg-sky-700" : tier === "casual" ? "bg-stone-700" : "bg-black/40"
  return (<div className="flex items-center gap-2">
    <span className="w-44 font-mono text-xs text-white/60">{metric}</span>
    <input
      className="w-24 rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
      disabled={disabled}
      step="0.1"
      type="number"
      value={val}
      onBlur={() => {
        const n = Number(val)
        if (!Number.isNaN(n) && n !== baseline) onCommit(n)
      }}
      onChange={(e) => {
        setVal(e.target.value)
      }}/>
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${tierColor}`}>
      {tier ?? "—"}
    </span>
  </div>)
}
