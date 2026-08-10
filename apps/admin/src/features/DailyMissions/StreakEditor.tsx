import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {useGetStreakChestRewardsQuery, useSaveStreakChestRewardsMutation} from "./DailyMissionsApi"
import type {StreakChestRewardInsert, StreakChestRewardRow} from "./DailyMissionsData"
import type {RewardRow} from "./MissionsAdminShared"
import {RewardBundleEditor} from "./MissionsAdminShared"

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
    return (<div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55">
      Loading streak chest rewards…
    </div>)
  }

  return (<div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
    <h3 className="mb-3 font-bold text-amber-100">7-Day Streak Chest contents</h3>
    <p className="mb-3 text-xs text-white/60">
      The single bundle awarded when a player claims the streak chest (after 7 consecutive days of completing
      all daily missions). Currency amounts add to wallet; item rewards drop into the player's inventory.
    </p>
    <RewardBundleEditor
      disabled={!canManage}
      rows={rewards}
      onChange={setRewards}/>
    {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
    {canManage && (<button
      className="mt-4 rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
      disabled={saving}
      type="button"
      onClick={save}>
      {saving ? "Saving…" : "Save streak chest"}
    </button>)}
  </div>)
}
