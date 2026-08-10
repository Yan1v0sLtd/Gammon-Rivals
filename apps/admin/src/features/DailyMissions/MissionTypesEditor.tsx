import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useGetMissionTypeConfigsQuery, useUpdateMissionTypeConfigMutation} from "./DailyMissionsApi"
import type {MissionTypeConfigRow, MissionTypeConfigUpdate} from "./DailyMissionsData"
import type {MissionTypeConfig} from "./MissionsAdminShared"
import {Field} from "./MissionsAdminShared"

const COEFFICIENT_FIELDS: readonly {
  readonly key: keyof MissionTypeConfig,
  readonly label: string,
  readonly step: number,
  readonly hint: string,
}[] = [{
  key: "base_stretch",
  label: "Base stretch",
  step: 0.05,
  hint: "Cold-start goal = ceil(baseline × this).",
}, {
  key: "up_step",
  label: "Ramp step (+)",
  step: 1,
  hint: "Goal increase after a completed mission.",
}, {
  key: "ease_after",
  label: "Ease after N miss",
  step: 1,
  hint: "Misses before the goal eases.",
}, {
  key: "ease_factor",
  label: "Ease factor",
  step: 0.05,
  hint: "On ease: goal = last completed × this.",
}, {
  key: "floor_mult",
  label: "Floor ×baseline",
  step: 0.05,
  hint: "Lower clamp = ceil(baseline × this).",
}, {
  key: "cap_mult",
  label: "Cap ×baseline",
  step: 0.5,
  hint: "Upper clamp = ceil(baseline × this).",
}, {
  key: "reward_pct",
  label: "Reward % of loss",
  step: 0.01,
  hint: "Reward = this × expected loss. Must stay < 1.",
}, {
  key: "floor_reward",
  label: "Floor reward",
  step: 50,
  hint: "Minimum coin reward, before rounding.",
}, {
  key: "round_to",
  label: "Round reward to",
  step: 50,
  hint: "Reward is rounded to this multiple.",
}, {
  key: "baseline_window_days",
  label: "Baseline window (d)",
  step: 5,
  hint: "Days of history used for the baseline median.",
}, {
  key: "goal_round_to",
  label: "Goal rounding",
  step: 1,
  hint: "Goal rounds to this multiple (1 for counts, e.g. 250 for coins).",
}]

export function MissionTypesEditor({canManage}: {
  readonly canManage: boolean,
}) {
  const {
    data: rowsQuery = [],
    error: rowsError,
    isLoading: rowsLoading,
  } = useGetMissionTypeConfigsQuery()

  const [updateMissionTypeConfig] = useUpdateMissionTypeConfigMutation()

  // Local mirror of the server snapshot, rebuilt only when the query data
  // reference changes (initial load, or after a DailyMissions tag
  // invalidation refetches). An in-progress edit draft is separate state
  // and is never overwritten by this sync.
  const [rows, setRows] = useState<MissionTypeConfig[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<MissionTypeConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const lastSyncedRowsRef = useRef<readonly MissionTypeConfigRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedRowsRef.current === rowsQuery) return
    lastSyncedRowsRef.current = rowsQuery
    setRows([...rowsQuery])
  }, [rowsQuery])

  // Query failures surface through the same inline error the saves use.
  useEffect(() => {
    if (rowsError) setError(rowsError.message ?? "Failed to load mission type configs.")
  }, [rowsError])

  const startEdit = (r: MissionTypeConfig) => {
    setEditing(r.mission_type)
    setDraft({...r})
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      // mission_type is the PK; metric_code + is_wired are code-derived truth,
      // not operator-editable here — so they're intentionally not in the update.
      const patch: MissionTypeConfigUpdate = {
        label: draft.label,
        description: draft.description,
        supports_personalized: draft.supports_personalized,
        base_stretch: draft.base_stretch,
        up_step: draft.up_step,
        ease_after: draft.ease_after,
        ease_factor: draft.ease_factor,
        floor_mult: draft.floor_mult,
        cap_mult: draft.cap_mult,
        reward_pct: draft.reward_pct,
        floor_reward: draft.floor_reward,
        round_to: draft.round_to,
        baseline_window_days: draft.baseline_window_days,
        goal_round_to: draft.goal_round_to,
        rollout_pct: draft.rollout_pct,
      }
      // The DailyMissions tag invalidation refetches the rows; no manual
      // reload needed.
      await updateMissionTypeConfig({
        missionType: draft.mission_type,
        patch,
      }).unwrap()
      setEditing(null)
      setDraft(null)
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  // Initial load gate: don't render the "No mission types configured"
  // empty state while the first payload is still fetching.
  if (rowsLoading) {
    return (<div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55">
        Loading mission types…
      </div>
    </div>)
  }

  return (<div className="space-y-3">
    <p className="max-w-3xl text-xs leading-relaxed text-white/60">
      The mission-type registry. Each type binds to a progress{" "}
      <span className="font-mono text-white/80">metric</span>;{" "}
      <span className="font-bold text-emerald-300">wired</span> means that event actually fires in the
      game today (a <span className="font-bold text-rose-300">not-wired</span> type will never make
      progress — fix the hook or retire it). For{" "}
      <span className="font-bold text-sky-300">personalized</span> types, the coefficients drive the
      adaptive goal + self-funding reward (design doc §G).
    </p>

    {rows.map((r) => (<div
      key={r.mission_type}
      className={`rounded-xl border bg-white/[0.045] p-3 ${editing === r.mission_type ? "border-amber-500/60" : "border-white/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-white">{r.label}</span>
            {r.is_wired ? <span
              className="rounded bg-emerald-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">● wired</span>
              : <span
                className="rounded bg-rose-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">✗ not wired</span>}
            {r.supports_personalized && (<span
              className="rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200">personalized</span>)}
            {r.supports_personalized && r.rollout_pct > 0 && (<span
              className="rounded bg-emerald-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">{r.rollout_pct}% live</span>)}
          </div>
          <div className="mt-0.5 font-mono text-xs text-white/50">{r.mission_type} → {r.metric_code}</div>
          {r.description && <div className="mt-1 text-xs text-white/60">{r.description}</div>}
        </div>
        {canManage && (<button
          className="shrink-0 rounded bg-amber-500/20 px-3 py-1 text-sm text-amber-100 hover:bg-amber-500/30"
          type="button"
          onClick={() => {
            if (editing === r.mission_type) {
              setEditing(null)
            }
            else {
              startEdit(r)
            }
          }}>
          {editing === r.mission_type ? "Close" : "Edit"}
        </button>)}
      </div>

      {editing === r.mission_type && draft && (<div className="mt-3 space-y-3 border-t border-white/10 pt-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Label">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="text"
              value={draft.label}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  label: e.target.value,
                })
              }}/>
          </Field>
          <Field label="Personalized">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                checked={draft.supports_personalized}
                disabled={!canManage}
                type="checkbox"
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    supports_personalized: e.target.checked,
                  })
                }}/>
              {draft.supports_personalized ? "Adaptive goal + reward" : "Fixed/stretch only"}
            </label>
          </Field>
          {draft.supports_personalized && (<Field label="Rollout %">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              max={100}
              min={0}
              type="number"
              value={draft.rollout_pct}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  rollout_pct: Math.max(0, Math.min(100, Number(e.target.value))),
                })
              }}/>
            <span className="mt-0.5 block text-[10px] text-white/35">
              % of players the nightly cron assigns this personalized mission (occupies one common slot). 0 = off.
            </span>
          </Field>)}
          <Field
            wide
            label="Description">
            <textarea
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              rows={2}
              value={draft.description ?? ""}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  description: e.target.value,
                })
              }}/>
          </Field>
        </div>

        {draft.supports_personalized && (<div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-sky-200/70">
            Personalized coefficients
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {COEFFICIENT_FIELDS.map((f) => (<label
              key={f.key}
              className="block">
              <span
                className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/50">{f.label}</span>
              <input
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                disabled={!canManage}
                step={f.step}
                type="number"
                value={String(draft[f.key] as number)}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    [f.key]: Number(e.target.value),
                  })
                }}/>
              <span className="mt-0.5 block text-[10px] text-white/35">{f.hint}</span>
            </label>))}
          </div>
          <p className="mt-2 text-[10px] text-amber-200/70">
            Reward % of loss must stay below 1 — the economy only remains a net sink while it does.
          </p>
        </div>)}

        {error && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
        {canManage && (<button
          className="rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={saving}
          type="button"
          onClick={save}>
          {saving ? "Saving…" : "Save type"}
        </button>)}
      </div>)}
    </div>))}

    {rows.length === 0 && <div className="text-sm text-white/40">No mission types configured.</div>}
    {error && editing === null && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
  </div>)
}
