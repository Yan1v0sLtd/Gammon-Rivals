import {useEffect, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"

import {
  useGetChestMilestonesQuery,
  useGetChestRewardsQuery,
  useSaveChestMilestoneMutation,
} from "./DailyMissionsApi"
import type {
  ChestMilestoneRow,
  ChestMilestoneUpdate,
  ChestRewardInsert,
  ChestRewardRow,
} from "./DailyMissionsData"
import {Field, RewardBundleEditor} from "./MissionsAdminShared"
import type {RewardRow} from "./MissionsAdminShared"

export function ChestsEditor({canManage}: {readonly canManage: boolean}) {
  const {
    data: chestsQuery = [],
    error: chestsError,
    isLoading: chestsLoading,
  } = useGetChestMilestonesQuery()
  const {
    data: chestRewardsQuery = [],
    error: chestRewardsError,
    isLoading: chestRewardsLoading,
  } = useGetChestRewardsQuery()

  const [saveChestMilestone] = useSaveChestMilestoneMutation()

  // Local mirrors of the server snapshots, same pattern as TemplatesEditor:
  // the RTK Query cache is the source of truth and each mirror is rebuilt
  // when the query data reference changes (initial load, or after a
  // DailyMissions tag invalidation refetches). The active draft lives in
  // separate state, so in-progress edits are never overwritten.
  const [chests, setChests] = useState<ChestMilestoneRow[]>([])
  const [rewardsByMilestone, setRewardsByMilestone] = useState<Record<string, RewardRow[]>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftChest, setDraftChest] = useState<ChestMilestoneRow | null>(null)
  const [draftRewards, setDraftRewards] = useState<RewardRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const lastSyncedChestsRef = useRef<readonly ChestMilestoneRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedChestsRef.current === chestsQuery) return
    lastSyncedChestsRef.current = chestsQuery
    setChests([...chestsQuery])
  }, [chestsQuery])
  const lastSyncedChestRewardsRef = useRef<readonly ChestRewardRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedChestRewardsRef.current === chestRewardsQuery) return
    lastSyncedChestRewardsRef.current = chestRewardsQuery
    const grouped: Record<string, RewardRow[]> = {}
    for (const r of chestRewardsQuery) {
      const key = r.milestone_id ?? "";
      (grouped[key] ??= []).push(r)
    }
    setRewardsByMilestone(grouped)
  }, [chestRewardsQuery])

  // Query failures surface through the same inline error the saves use.
  useEffect(() => {
    if (chestsError) setError(chestsError.message ?? "Failed to load chest milestones.")
  }, [chestsError])
  useEffect(() => {
    if (chestRewardsError) setError(chestRewardsError.message ?? "Failed to load chest rewards.")
  }, [chestRewardsError])

  // With no row expanded the per-row error has no home, so load failures
  // render at the top instead. While a row is open these messages stay in
  // that row's inline error, so the same failure is never shown twice.
  const loadErrors = editingId === null ? [
    chestsError ? (chestsError.message ?? "Failed to load chest milestones.") : null,
    chestRewardsError ? (chestRewardsError.message ?? "Failed to load chest rewards.") : null,
  ].filter((m): m is string => m !== null) : []

  const startEdit = (c: ChestMilestoneRow) => {
    setEditingId(c.id)
    setDraftChest({...c})
    setDraftRewards(rewardsByMilestone[c.id] ?? [])
    setError(null)
  }

  const save = async () => {
    if (!draftChest) return
    setSaving(true)
    setError(null)
    try {
      const id = draftChest.id
      // Same column set the inline update wrote: everything on the row
      // except the identity and the server-managed timestamps.
      const patch: ChestMilestoneUpdate = {
        milestone_index: draftChest.milestone_index,
        threshold_mp: draftChest.threshold_mp,
        display_name: draftChest.display_name,
        rarity: draftChest.rarity,
        enabled: draftChest.enabled,
      }
      const rewards: ChestRewardInsert[] = draftRewards.map((r, i) => ({
        milestone_id: id,
        reward_kind: r.reward_kind,
        currency_code: r.reward_kind === "currency" ? r.currency_code : null,
        item_table: r.reward_kind === "item" ? r.item_table : null,
        item_id: r.reward_kind === "item" ? r.item_id : null,
        amount: r.amount,
        display_order: r.display_order ?? i,
      }))
      await saveChestMilestone({
        id,
        patch,
        rewards,
      }).unwrap()
      setEditingId(null)
      setDraftChest(null)
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  if (chestsLoading || chestRewardsLoading) {
    return (<div className="rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55">
      Loading chest milestones…
    </div>)
  }

  return (<div className="space-y-3">
    {loadErrors.map((m) => (<div
      key={m}
      className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
      {m}
    </div>))}

    {chests.map((c) => (<div
      key={c.id}
      className={`rounded-xl border bg-white/[0.045] p-3 ${editingId === c.id ? "border-amber-500/60" : "border-white/10"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            alt=""
            className="h-10 w-10 object-contain"
            draggable={false}
            src={`/lobby/missions/chest-${c.milestone_index}.webp`}
            onError={(e) => ((e.currentTarget).style.display = "none")}/>
          <div>
            <div className="font-bold text-white">{c.display_name}</div>
            <div className="text-xs text-white/60">
              Milestone {c.milestone_index} · {c.threshold_mp} MP · {c.rarity}
              · {c.enabled ? "enabled" : "disabled"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(rewardsByMilestone[c.id] ?? []).map((r) => (
                <span
                  key={`${r.amount}-${r.reward_kind}-${r.currency_code ?? r.item_id ?? ""}`}
                  className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">
                  +{r.amount} {r.reward_kind === "currency" ? r.currency_code : r.item_id}
                </span>))}
            </div>
          </div>
        </div>
        {canManage && (<button
          className="rounded bg-amber-500/20 px-3 py-1 text-sm text-amber-100 hover:bg-amber-500/30"
          type="button"
          onClick={() => {
            if (editingId === c.id) setEditingId(null)
            else startEdit(c)
          }}>
          {editingId === c.id ? "Close" : "Edit"}
        </button>)}
      </div>

      {editingId === c.id && draftChest && (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2">
          <Field label="Display name">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              type="text"
              value={draftChest.display_name}
              onChange={(e) => {
                setDraftChest({
                  ...draftChest,
                  display_name: e.target.value,
                })
              }}/>
          </Field>
          <Field label="Threshold MP">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              type="number"
              value={draftChest.threshold_mp}
              onChange={(e) => {
                setDraftChest({
                  ...draftChest,
                  threshold_mp: Number(e.target.value),
                })
              }}/>
          </Field>
          <Field label="Rarity">
            <select
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              value={draftChest.rarity}
              onChange={(e) => {
                setDraftChest({
                  ...draftChest,
                  rarity: e.target.value,
                })
              }}>
              <option value="common">common</option>
              <option value="rare">rare</option>
              <option value="epic">epic</option>
              <option value="legendary">legendary</option>
            </select>
          </Field>
          <Field label="Enabled">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                checked={draftChest.enabled}
                type="checkbox"
                onChange={(e) => {
                  setDraftChest({
                    ...draftChest,
                    enabled: e.target.checked,
                  })
                }}/>
              {draftChest.enabled ? "Active" : "Hidden"}
            </label>
          </Field>
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs uppercase tracking-wider text-amber-100/70">Reward bundle</div>
            <RewardBundleEditor
              disabled={!canManage}
              rows={draftRewards}
              onChange={setDraftRewards}/>
          </div>
          {error && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200 sm:col-span-2">{error}</div>}
          <div className="sm:col-span-2 flex gap-2">
            <button
              className="flex-1 rounded bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              disabled={saving}
              type="button"
              onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>)}
    </div>))}
  </div>)
}
