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
import styles from "./SimulatorTab.module.css"

/** Metrics the operator can author baselines for. The Phase 4
 *  triggers feed these for real users; for synthetic users we
 *  set them directly. */
const KNOWN_METRICS = ["matches_per_day", "coins_wagered_per_day", "coins_won_net_per_day", "xp_per_day", "gems_spent_per_day", "wheel_spins_per_day", "ranked_wins_per_week", "win_streak", "levels_per_week"]

export function SimulatorTab({canManage}: {
  readonly canManage: boolean,
}) {
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

  return (<div className={styles.container}>
    {confirmUI}
    {/* Left column: profile list + new-profile form + bulk spawn */}
    <div className={styles.leftCol}>
      <div className={styles.panel}>
        <h4 className={styles.panelTitle}>Create test user</h4>
        <input
          className={styles.textInput}
          disabled={!canManage}
          placeholder="display name"
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
          }}/>
        <div className={styles.numGrid}>
          <label className={styles.inputLabel}>
            Level
            <input
              className={styles.numInput}
              disabled={!canManage}
              type="number"
              value={newLevel}
              onChange={(e) => {
                setNewLevel(Number(e.target.value))
              }}/>
          </label>
          <label className={styles.inputLabel}>
            pvp_rating
            <input
              className={styles.numInput}
              disabled={!canManage}
              type="number"
              value={newRating}
              onChange={(e) => {
                setNewRating(Number(e.target.value))
              }}/>
          </label>
        </div>
        {canManage && (<button
          className={styles.createButton}
          disabled={busy || !newName.trim()}
          type="button"
          onClick={createProfile}>
          + Create
        </button>)}
      </div>

      <div className={styles.panel}>
        <h4 className={styles.panelTitle}>Spawn archetypes (bulk)</h4>
        <div className={styles.spawnGrid}>
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
            className={styles.inputLabel}>
            {row.label}
            <input
              className={styles.numInput}
              disabled={!canManage}
              type="number"
              value={row.value}
              onChange={(e) => {
                row.set(Number(e.target.value))
              }}/>
          </label>))}
        </div>
        {canManage && (<button
          className={styles.spawnButton}
          disabled={busy}
          type="button"
          onClick={spawnArchetypes}>
          Spawn + assign + recompute
        </button>)}
      </div>

      <div className={styles.panelFlush}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>Test users ({profiles.length})</span>
          {canManage && profiles.length > 0 && (<button
            className={styles.deleteAllButton}
            disabled={busy}
            type="button"
            onClick={cleanupAll}>
            Delete all
          </button>)}
        </div>
        <div className={styles.profileList}>
          {profiles.length === 0 ? (
            <div className={styles.profileEmpty}>No synthetic profiles yet.</div>) : (profiles.map((p) => (<button
            key={p.id}
            className={styles.profileRow + (selectedId === p.id ? " " + styles.profileRowActive : "")}
            type="button"
            onClick={() => {
              setSelectedId(p.id)
            }}>
            <span className={styles.profileName}>{p.display_name}</span>
            <span className={styles.profileMeta}>L{p.level} · {p.pvp_rating}</span>
          </button>)))}
        </div>
      </div>
    </div>

    {/* Right column: selected user detail */}
    <div className={styles.detailPanel}>
      {!state ? (<p className={styles.detailEmpty}>Select a test user, or create one to begin.</p>) : (<>
        <div className={styles.detailHeader}>
          <div>
            <h3 className={styles.profileTitle}>{state.profile.display_name}</h3>
            <div className={styles.profileSub}>
              Level {state.profile.level} · pvp_rating {state.profile.pvp_rating} · {state.profile.xp} XP
            </div>
          </div>
          {canManage && (<button
            className={styles.reassignButton}
            disabled={busy}
            type="button"
            onClick={reassign}>
            Reset & re-assign
          </button>)}
        </div>

        {/* Metrics editor */}
        <div className={styles.section}>
          <h4 className={styles.panelTitle}>
            Metric baselines (drives stretch resolution + tier)
          </h4>
          <div className={styles.metricList}>
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
          <h4 className={styles.panelTitle}>
            Active missions ({state.missions.length})
          </h4>
          {state.missions.length === 0 ? (
            <p className={styles.missionEmpty}>No missions assigned — hit Reset &amp; re-assign.</p>) : (
            <div className={styles.missionList}>
              {state.missions.map((m) => (<div
                key={m.id}
                className={styles.missionCard}>
                <div className={styles.missionHeader}>
                  <span className={styles.missionTitle}>{m.title}</span>
                  <span
                    className={styles.rarityBadge + " " + (m.rarity === "epic" ? styles.rarityEpic : m.rarity === "rare" ? styles.rarityRare : styles.rarityCommon)}>{m.rarity}{m.period === "weekly" ? " · weekly" : ""}</span>
                </div>
                <div className={styles.missionMeta}>
                  <span className={styles.mono}>{m.mission_type}</span>
                  <span>→ goal {m.resolved_goal} ({m.resolution_mode})</span>
                  <span>+{m.mission_points} MP</span>
                  {m.rewards.length > 0 && (<span>
                    {m.rewards.map((r) => (<span
                      key={`${r.amount}-${String(r.currency_code)}`}
                      className={styles.rewardChip}>
                      +{r.amount} {r.currency_code}
                    </span>))}
                  </span>)}
                </div>
              </div>))}
            </div>)}
        </div>
      </>)}
      {error && <div className={styles.errorBox}>{error}</div>}
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
  const tierColor = tier === "whale" ? styles.tierWhale : tier === "regular" ? styles.tierRegular : tier === "casual" ? styles.tierCasual : styles.tierNone
  return (<div className={styles.metricRow}>
    <span className={styles.metricName}>{metric}</span>
    <input
      className={styles.metricInput}
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
    <span className={styles.tierBadge + " " + tierColor}>
      {tier ?? "—"}
    </span>
  </div>)
}
