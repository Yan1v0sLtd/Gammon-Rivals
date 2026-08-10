import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useGetRerollPricingConfigQuery, useUpdateRerollPricingConfigMutation} from "./DailyMissionsApi"
import type {RerollPricingConfigRow} from "./DailyMissionsData"
import {Field} from "./MissionsAdminShared"
import styles from "./RerollEditor.module.css"

export function RerollEditor({canManage}: {
  readonly canManage: boolean,
}) {
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
    return (<div className={styles.loadingCard}>
      Loading reroll pricing…
    </div>)
  }

  return (<div className={styles.card}>
    <h3 className={styles.title}>Reroll pricing</h3>
    <p className={styles.description}>
      Escalating gem cost per reroll. <code>ladder[i]</code> is the cost of the i-th reroll on a given day
      (0-indexed; ladder[0] should be 0 so the first reroll is free).
    </p>

    <div className={styles.ladderList}>
      {ladder.map((cost, i) => (<div
        key={`reroll-cost-${cost}`}
        className={styles.ladderRow}>
        <span className={styles.rungIndex}>#{i + 1}</span>
        <input
          className={styles.rungInput}
          disabled={!canManage}
          type="number"
          value={cost}
          onChange={(e) => {
            const next = [...ladder]
            next[i] = Number(e.target.value)
            setLadder(next)
          }}/>
        <span className={styles.rungUnit}>gems</span>
        {canManage && (<button
          className={styles.removeButton}
          type="button"
          onClick={() => {
            setLadder(ladder.filter((_, j) => j !== i))
          }}>
          ✕
        </button>)}
      </div>))}
      {canManage && (<button
        className={styles.addButton}
        type="button"
        onClick={() => {
          setLadder([...ladder, 100])
        }}>
        + Add rung
      </button>)}
    </div>

    <div className={styles.capSection}>
      <Field label="Daily cap (max rerolls per player per day)">
        <input
          className={styles.capInput}
          disabled={!canManage}
          type="number"
          value={dailyCap}
          onChange={(e) => {
            setDailyCap(Number(e.target.value))
          }}/>
      </Field>
    </div>

    {error && <div className={styles.errorBox}>{error}</div>}
    {canManage && (<button
      className={styles.saveButton}
      disabled={saving}
      type="button"
      onClick={save}>
      {saving ? "Saving…" : "Save pricing"}
    </button>)}
  </div>)
}
