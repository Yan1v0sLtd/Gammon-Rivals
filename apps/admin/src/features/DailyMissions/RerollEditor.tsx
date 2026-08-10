import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {
  useGetRerollPricingConfigQuery,
  useUpdateRerollPricingConfigMutation,
} from "./DailyMissionsApi"
import type {RerollPricingConfigRow} from "./DailyMissionsData"
import {Field} from "./MissionsAdminShared"

export function RerollEditor({canManage}: {readonly canManage: boolean}) {
  const {
    data: pricingQuery = null,
    error: pricingError,
    isLoading: pricingLoading,
  } = useGetRerollPricingConfigQuery()

  const [updateRerollPricingConfig] = useUpdateRerollPricingConfigMutation()

  const [ladder, setLadder] = useState<number[]>([])
  const [dailyCap, setDailyCap] = useState(4)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The singleton row is edited in place, so the local ladder/cap drafts are
  // seeded from the query snapshot and re-seeded whenever the cached row
  // reference changes (initial load, or a DailyMissions invalidation refetch).
  const lastSyncedPricingRef = useRef<RerollPricingConfigRow | null | undefined>(undefined)
  useEffect(() => {
    if (lastSyncedPricingRef.current === pricingQuery) return
    lastSyncedPricingRef.current = pricingQuery
    if (!pricingQuery) return
    setLadder((pricingQuery.gem_cost_ladder ?? []).slice())
    setDailyCap(pricingQuery.daily_cap)
  }, [pricingQuery])

  useEffect(() => {
    if (pricingError) setError(pricingError.message ?? "Failed to load reroll pricing.")
  }, [pricingError])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateRerollPricingConfig({
        gem_cost_ladder: ladder,
        daily_cap: dailyCap,
      }).unwrap()
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  if (pricingLoading) {
    return (<div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55">
      Loading reroll pricing…
    </div>)
  }

  return (<div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
    <h3 className="mb-3 font-bold text-amber-100">Reroll pricing</h3>
    <p className="mb-3 text-xs text-white/60">
      Escalating gem cost per reroll. <code>ladder[i]</code> is the cost of the i-th reroll on a given day
      (0-indexed; ladder[0] should be 0 so the first reroll is free).
    </p>

    <div className="space-y-2">
      {ladder.map((cost, i) => (<div
        key={`reroll-cost-${cost}`}
        className="flex items-center gap-2">
        <span className="w-10 text-xs text-white/50">#{i + 1}</span>
        <input
          className="flex-1 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          disabled={!canManage}
          type="number"
          value={cost}
          onChange={(e) => {
            const next = [...ladder]
            next[i] = Number(e.target.value)
            setLadder(next)
          }}/>
        <span className="text-xs text-white/50">gems</span>
        {canManage && (<button
          className="rounded bg-rose-700/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-700/60"
          type="button"
          onClick={() => {
            setLadder(ladder.filter((_, j) => j !== i))
          }}>
          ✕
        </button>)}
      </div>))}
      {canManage && (<button
        className="rounded bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
        type="button"
        onClick={() => {
          setLadder([...ladder, 100])
        }}>
        + Add rung
      </button>)}
    </div>

    <div className="mt-4">
      <Field label="Daily cap (max rerolls per player per day)">
        <input
          className="w-32 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          disabled={!canManage}
          type="number"
          value={dailyCap}
          onChange={(e) => {
            setDailyCap(Number(e.target.value))
          }}/>
      </Field>
    </div>

    {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
    {canManage && (<button
      className="mt-4 rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
      disabled={saving}
      type="button"
      onClick={save}>
      {saving ? "Saving…" : "Save pricing"}
    </button>)}
  </div>)
}
