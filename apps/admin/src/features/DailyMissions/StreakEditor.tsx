import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useGetStreakChestRewardsQuery, useSaveStreakChestRewardsMutation} from "./DailyMissionsApi"
import type {StreakChestRewardInsert, StreakChestRewardRow} from "./DailyMissionsData"
import type {RewardRow} from "./MissionsAdminShared"
import {RewardBundleEditor} from "./MissionsAdminShared"
import styles from "./StreakEditor.module.css"

export function StreakEditor({canManage}: {
  readonly canManage: boolean,
}) {
  const {
    data: streakQuery = [],
    error: streakError,
    isLoading: streakLoading,
  } = useGetStreakChestRewardsQuery()

  const [saveStreakChestRewards] = useSaveStreakChestRewardsMutation()

  // The bundle is edited in place, so the local rows are re-seeded from the
  // query snapshot whenever the cached reference changes (initial load, or a
  // DailyMissions invalidation refetch after a save).
  const [rewards, setRewards] = useState<RewardRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const lastSyncedStreakRef = useRef<readonly StreakChestRewardRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedStreakRef.current === streakQuery) return
    lastSyncedStreakRef.current = streakQuery
    setRewards([...streakQuery])
  }, [streakQuery])

  useEffect(() => {
    if (streakError) setError(streakError.message ?? "Failed to load streak chest rewards.")
  }, [streakError])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // The data layer keeps the sentinel-guarded delete-then-reinsert
      // replacement; it is ordered, not transactional.
      const rows: StreakChestRewardInsert[] = rewards.map((r, i) => ({
        reward_kind: r.reward_kind,
        currency_code: r.reward_kind === "currency" ? r.currency_code : null,
        item_table: r.reward_kind === "item" ? r.item_table : null,
        item_id: r.reward_kind === "item" ? r.item_id : null,
        amount: r.amount,
        display_order: r.display_order ?? i,
      }))
      await saveStreakChestRewards(rows).unwrap()
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  if (streakLoading) {
    return (<div className={styles.loadingCard}>
      Loading streak chest rewards…
    </div>)
  }

  return (<div className={styles.card}>
    <h3 className={styles.title}>7-Day Streak Chest contents</h3>
    <p className={styles.description}>
      The single bundle awarded when a player claims the streak chest (after 7 consecutive days of completing
      all daily missions). Currency amounts add to wallet; item rewards drop into the player's inventory.
    </p>
    <RewardBundleEditor
      disabled={!canManage}
      rows={rewards}
      onChange={setRewards}/>
    {error && <div className={styles.errorBox}>{error}</div>}
    {canManage && (<button
      className={styles.saveButton}
      disabled={saving}
      type="button"
      onClick={save}>
      {saving ? "Saving…" : "Save streak chest"}
    </button>)}
  </div>)
}
