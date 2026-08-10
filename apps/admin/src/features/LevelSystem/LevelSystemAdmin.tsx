import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {buildCurrencyRateMap, formatUsdMicros, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import {resolveStatusLabel} from "../../../../../packages/shared/src/progression"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import {type LevelDraft, levelToDraft} from "../../lib/levelToDraft"
import {parseJson} from "../../lib/parseJson"
import {requiredNumber} from "../../lib/requiredNumber"
import {useAdminAuth} from "../../lib/useAdminAuth"
import {useGetCurrenciesQuery} from "../Currencies/CurrenciesApi"

import {LevelCurveProposal} from "./LevelCurveProposal"
import styles from "./LevelSystemAdmin.module.css"
import {
  useApplyLevelCurveMutation,
  useDeleteLevelStatusTiersMutation,
  useGetLevelConfigsQuery,
  useGetLevelStatusTiersQuery,
  useInsertLevelStatusTiersMutation,
  useRecomputePlayerLevelsMutation,
  useUpdateLevelStatusTierMutation,
  useUpsertLevelMutation,
} from "./LevelSystemApi"
import type {
  LevelConfigInsert, LevelStatusTierInsert, LevelStatusTierRow, LevelStatusTierUpdate,
} from "./LevelSystemData"

/**
 * Editable per-row state for the Status Tiers panel. We keep `id`
 * nullable so a brand-new row (not yet inserted) can sit alongside
 * existing ones in the same draft array. All numeric fields are
 * stored as strings so the inputs can be empty mid-edit without
 * blanking the form state.
 */
type LevelStatusTierDraft = {
  id: string | null,
  level_from: string,
  level_to: string,
  label: string,
  sort_order: string,
  is_enabled: boolean,
}
/**
 * Number of rows shown at once in the Levels table. The curve can
 * easily hit 100+ levels, so we paginate to keep the BO scrollable.
 * 'all' is the escape hatch for spreadsheet-style scanning.
 */
type LevelsPageSize = 25 | 50 | 100 | "all"

type Props = {
  readonly canManage: boolean,
}

/**
 * Level System BO admin — the Status Tiers panel, the paginated Levels
 * table + editor, and the Level Curve proposal. Self-contained vertical
 * slice: it owns its RTK Query hooks (level configs, status tiers,
 * currencies) and all local editable state, and saves through the Level
 * System mutations. No direct Supabase calls here.
 */
export function LevelSystemAdmin({
  canManage,
}: Props) {
  const {user} = useAdminAuth()
  const currentUserId = user?.id ?? null

  // Server snapshots owned by RTK Query. The `LevelSystem` tag
  // invalidation on every mutation refetches both queries, so the
  // tables stay in sync after saves without any manual reload.
  const {
    data: levels = [],
    error: levelsError,
    isLoading: levelsLoading,
  } = useGetLevelConfigsQuery()
  const {
    data: levelStatusTiers = [],
    error: tiersError,
    isLoading: tiersLoading,
  } = useGetLevelStatusTiersQuery()
  // Currencies feed the $ value columns + the curve's coin/gem rates.
  const {
    data: currencies = [],
  } = useGetCurrenciesQuery()
  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies])

  // Mutations — one per write path. `.unwrap()` surfaces failures so we
  // can show them in the existing inline error UI.
  const [upsertLevel, {isLoading: levelSaving}] = useUpsertLevelMutation()
  const [deleteLevelStatusTiers] = useDeleteLevelStatusTiersMutation()
  const [insertLevelStatusTiers] = useInsertLevelStatusTiersMutation()
  const [updateLevelStatusTier] = useUpdateLevelStatusTierMutation()
  const [applyLevelCurve] = useApplyLevelCurveMutation()
  const [recomputePlayerLevels] = useRecomputePlayerLevelsMutation()

  // Local editable state.
  const [tierDrafts, setTierDrafts] = useState<LevelStatusTierDraft[]>([])
  const [levelDraft, setLevelDraft] = useState<LevelDraft>(() => levelToDraft())
  const [levelsPageSize, setLevelsPageSize] = useState<LevelsPageSize>(50)
  const [levelsPageIndex, setLevelsPageIndex] = useState(0)
  const [savingTiers, setSavingTiers] = useState(false)
  const [tierError, setTierError] = useState<string | null>(null)
  const [tierMessage, setTierMessage] = useState<string | null>(null)
  // Page-level error for query failures + the level editor save.
  const [error, setError] = useState<string | null>(null)

  // Rebuild the tier drafts from the server snapshot whenever the query
  // data reference changes (initial load + after any LevelSystem
  // mutation invalidates the tag and refetches). During editing the
  // reference is stable, so in-progress edits are never clobbered.
  const lastSyncedTiersRef = useRef<readonly LevelStatusTierRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedTiersRef.current === levelStatusTiers) return
    lastSyncedTiersRef.current = levelStatusTiers
    setTierDrafts(levelStatusTiers.map((t) => ({
      id: t.id,
      level_from: String(t.level_from),
      level_to: String(t.level_to),
      label: t.label,
      sort_order: String(t.sort_order),
      is_enabled: t.is_enabled,
    })))
  }, [levelStatusTiers])

  // Surface query failures through the page-level error banner.
  useEffect(() => {
    if (levelsError) setError(levelsError.message ?? "Failed to load level configs.")
  }, [levelsError])
  useEffect(() => {
    if (tiersError) setError(tiersError.message ?? "Failed to load status tiers.")
  }, [tiersError])

  // Pagination math. `levels` is already sorted ascending by level in
  // the query. The page index is clamped to the valid range so changing
  // pageSize doesn't strand the user on a phantom page.
  const totalLevels = levels.length
  const effectivePageSize = levelsPageSize === "all" ? Math.max(totalLevels, 1) : levelsPageSize
  const totalPages = Math.max(1, Math.ceil(totalLevels / effectivePageSize))
  const clampedPageIndex = Math.min(Math.max(0, levelsPageIndex), totalPages - 1)
  const pageStart = clampedPageIndex * effectivePageSize
  const pageEnd = Math.min(pageStart + effectivePageSize, totalLevels)
  const pagedLevels = levels.slice(pageStart, pageEnd)
  const pageSizeOptions: LevelsPageSize[] = [25, 50, 100, "all"]

  // Each level's status is DERIVED from the tier ranges (the same
  // way the lobby derives it) — NOT from a per-row column. The old
  // list read `level_configs.status_label`, which doesn't exist, so
  // every level showed the "Rookie" fallback regardless of the
  // configured tiers. Built from the live tier drafts so the column
  // reflects edits in the panel above before they're even saved.
  const parsedTierRanges = tierDrafts
    .map((d, i) => ({
      level_from: Number.parseInt(d.level_from, 10),
      level_to: Number.parseInt(d.level_to, 10),
      label: d.label.trim(),
      sort_order: Number.parseInt(d.sort_order, 10) || i,
      is_enabled: d.is_enabled,
    }))
    .filter((t) => Number.isFinite(t.level_from) && Number.isFinite(t.level_to) && t.label.length > 0)

  function updateTierDraft(index: number, patch: Partial<LevelStatusTierDraft>) {
    setTierDrafts((rows) => rows.map((row, i) => (i === index ? {...row, ...patch} : row)))
  }

  function addBlankTier() {
    // Default the new row's level_from to one past the previous row's
    // level_to so a designer adding tiers in order doesn't have to
    // re-type the boundary. Empty list -> start at 1.
    const lastTo = tierDrafts.length ? Math.max(0, Number.parseInt(tierDrafts[tierDrafts.length - 1].level_to, 10) || 0) : 0
    const nextFrom = lastTo > 0 ? lastTo + 1 : 1
    setTierDrafts((rows) => [...rows, {
      id: null,
      level_from: String(nextFrom),
      level_to: "",
      label: "",
      sort_order: String(rows.length + 1),
      is_enabled: true,
    }])
  }

  function removeTierDraft(index: number) {
    setTierDrafts((rows) => rows.filter((_, i) => i !== index))
  }

  function resetTierDrafts() {
    setTierDrafts(levelStatusTiers.map((t) => ({
      id: t.id,
      level_from: String(t.level_from),
      level_to: String(t.level_to),
      label: t.label,
      sort_order: String(t.sort_order),
      is_enabled: t.is_enabled,
    })))
    setTierError(null)
    setTierMessage(null)
  }

  // The tier panel is a small inline list. `tierDrafts` is the editable
  // mirror of `levelStatusTiers` (the last loaded snapshot). On Save we
  // diff: any draft.id that no longer exists in drafts gets deleted,
  // any draft with id=null gets inserted, the rest get updated. Writes
  // run update → insert → delete so the destructive delete is last
  // (see saveTiers). Tag invalidation refetches fresh ids + timestamps.
  async function saveTiers() {
    if (!canManage || savingTiers) return
    setSavingTiers(true)
    setTierError(null)
    setTierMessage(null)
    try {
      // Validation is the only guarantee that bad input never reaches
      // the DB — the write sequence below is NOT transactional. A
      // failure mid-way can still leave a partially-applied save. We
      // only minimize the damage by running the destructive delete LAST,
      // after the replacement update/insert writes have succeeded.
      const validated = tierDrafts.map((draft, i) => {
        const from = Number.parseInt(draft.level_from, 10)
        const to = Number.parseInt(draft.level_to, 10)
        const sort = Number.parseInt(draft.sort_order, 10)
        if (!Number.isFinite(from) || from <= 0) {
          throw new Error(`Tier #${i + 1}: "From" must be a positive integer.`)
        }
        if (!Number.isFinite(to) || to < from) {
          throw new Error(`Tier #${i + 1}: "To" must be ≥ "From" (got ${draft.level_to}).`)
        }
        const label = draft.label.trim()
        if (!label) throw new Error(`Tier #${i + 1}: label is required.`)
        return {
          id: draft.id,
          level_from: from,
          level_to: to,
          label,
          sort_order: Number.isFinite(sort) ? sort : i + 1,
          is_enabled: draft.is_enabled,
        }
      })

      const draftIds = new Set(validated.map((v) => v.id).filter((id): id is string => !!id))
      const toDelete = levelStatusTiers
        .filter((existing) => !draftIds.has(existing.id))
        .map((t) => t.id)
      const toInsert = validated.filter((v) => v.id === null)
      const toUpdate = validated.filter((v) => v.id !== null)

      // Update existing rows first. No bulk update RPC for arbitrary
      // per-row changes, so issue a per-row update. The tier table is
      // small (~10 rows max).
      if (toUpdate.length > 0) {
        for (const row of toUpdate) {
          if (!row.id) continue
          const patch: LevelStatusTierUpdate = {
            level_from: row.level_from,
            level_to: row.level_to,
            label: row.label,
            sort_order: row.sort_order,
            is_enabled: row.is_enabled,
            updated_by: currentUserId,
          }
          await updateLevelStatusTier({
            id: row.id,
            patch,
          }).unwrap()
        }
      }
      // Insert new rows second, so the replacement rows exist before
      // any removals happen.
      if (toInsert.length > 0) {
        const rows: LevelStatusTierInsert[] = toInsert.map((row) => ({
          level_from: row.level_from,
          level_to: row.level_to,
          label: row.label,
          sort_order: row.sort_order,
          is_enabled: row.is_enabled,
          updated_by: currentUserId,
        }))
        await insertLevelStatusTiers(rows).unwrap()
      }
      // Delete removed rows last: if an update or insert above failed,
      // previously-valid tiers are still present instead of already
      // deleted.
      if (toDelete.length > 0) {
        await deleteLevelStatusTiers(toDelete).unwrap()
      }
      setTierMessage(`Saved. ${toInsert.length} added · ${toUpdate.length} updated · ${toDelete.length} removed.`)
    }
    catch (err) {
      setTierError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setSavingTiers(false)
    }
  }

  async function saveLevel() {
    if (!canManage) return
    setError(null)
    try {
      const level = requiredNumber(levelDraft.level, "Level")
      if (!Number.isInteger(level) || level < 1) {
        // The DB enforces `level > 0` on an int PK. A blank Level field
        // resolves to Number('') === 0, which used to hit the database and
        // surface the raw "level_configs_level_check" violation. Validate
        // here so the operator gets a clear message instead.
        throw new Error("Level must be a whole number of 1 or more.")
      }
      const payload: LevelConfigInsert = {
        level,
        xp_required: requiredNumber(levelDraft.xp_required, "XP required"),
        status_label: levelDraft.status_label.trim() || "Rookie",
        reward_coins: requiredNumber(levelDraft.reward_coins, "Reward coins"),
        reward_gems: requiredNumber(levelDraft.reward_gems, "Reward gems"),
        reward_items: parseJson(levelDraft.reward_items, "Reward items", "array"),
        unlock_rules: parseJson(levelDraft.unlock_rules, "Unlock rules", "object"),
        is_enabled: levelDraft.is_enabled,
        updated_by: currentUserId,
      }
      await upsertLevel(payload).unwrap()
      setLevelDraft(levelToDraft())
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function newLevel() {
    // Pre-fill the next free level so "New" on a packed 1..N table
    // proposes N+1 instead of a blank field (blank saved as level 0 and
    // tripped the `level > 0` check constraint). Operator can still
    // overwrite it.
    const nextLevel = levels.reduce((max, row) => Math.max(max, row.level), 0) + 1
    setLevelDraft({
      ...levelToDraft(),
      level: String(nextLevel),
    })
  }

  // Feature-owned curve callbacks — LevelCurveProposal delegates its DB
  // writes here. Tag invalidation refreshes the server snapshots.
  const applyCurve = useCallback(async (args: {
    rows: readonly LevelConfigInsert[],
    maxLevel: number,
  }) => {
    return applyLevelCurve(args).unwrap()
  }, [applyLevelCurve])
  const recompute = useCallback(async () => {
    return recomputePlayerLevels().unwrap()
  }, [recomputePlayerLevels])

  // Initial load gate: while the level configs / status tiers queries
  // are still fetching their first payload, don't render the empty
  // editors (they'd show a misleading "no rows" / blank form). Errors
  // surface through the existing banner below, so loading and error
  // are mutually exclusive here.
  const initialLoading = levelsLoading || tiersLoading

  return (<>
    {error ? (<div
      className={styles.errorBanner}>
      {error}
    </div>) : null}
    {initialLoading ? (<div
      className={styles.loadingCard}>
      Loading level system…
    </div>) : (<>
      {/* Status Tiers — declarative level → rank label. The
            lobby derives status from these rows in real time,
            so changes here propagate without re-applying the
            curve or touching individual level rows. */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Status tiers</h2>
          <span className={styles.panelTag}>
            declarative level → rank label
          </span>
        </div>
        <p className={styles.panelDesc}>
          Map level ranges to a rank label (Rookie, Veteran, etc.).
          The lobby derives a player's displayed status from these
          tiers — so changing a range updates every level without
          re-applying the curve. Ranges may overlap; the lowest
          sort_order wins.
        </p>
        <div className={styles.tierList}>
          {tierDrafts.length === 0 ? (<div
            className={styles.tierEmpty}>
            No tiers configured. Click "+ Add tier" to define your first range.
          </div>) : (<>
            <div
              className={styles.tierHeader}>
              <span>From</span>
              <span>To</span>
              <span>Label</span>
              <span>Sort</span>
              <span>Enabled</span>
              <span></span>
            </div>
            {tierDrafts.map((draft, i) => (<div
              key={`tier-${draft.id ?? `${draft.level_from}-${draft.level_to}-${draft.label}-${draft.sort_order}`}`}
              className={styles.tierRow}>
              <input
                className={styles.tierInput}
                min="1"
                type="number"
                value={draft.level_from}
                onChange={(e) => {
                  updateTierDraft(i, {level_from: e.target.value})
                }}/>
              <input
                className={styles.tierInput}
                min="1"
                type="number"
                value={draft.level_to}
                onChange={(e) => {
                  updateTierDraft(i, {level_to: e.target.value})
                }}/>
              <input
                className={styles.tierInputLabel}
                placeholder="Rookie"
                type="text"
                value={draft.label}
                onChange={(e) => {
                  updateTierDraft(i, {label: e.target.value})
                }}/>
              <input
                className={styles.tierInput}
                type="number"
                value={draft.sort_order}
                onChange={(e) => {
                  updateTierDraft(i, {sort_order: e.target.value})
                }}/>
              <label
                className={styles.tierCheckboxCell}>
                <input
                  checked={draft.is_enabled}
                  className={styles.tierCheckbox}
                  type="checkbox"
                  onChange={(e) => {
                    updateTierDraft(i, {is_enabled: e.target.checked})
                  }}/>
              </label>
              <button
                className={styles.tierRemove}
                title="Remove tier"
                type="button"
                onClick={() => {
                  removeTierDraft(i)
                }}>
                ×
              </button>
            </div>))}
          </>)}
        </div>
        <div className={styles.tierActions}>
          <SecondaryButton onClick={addBlankTier}>+ Add tier</SecondaryButton>
          <PrimaryButton
            disabled={!canManage || savingTiers}
            onClick={() => void saveTiers()}>
            {savingTiers ? "Saving…" : "Save tiers"}
          </PrimaryButton>
          <SecondaryButton onClick={resetTierDrafts}>Discard changes</SecondaryButton>
          {tierError ? (<span
            className={styles.tierStatus}>
            {tierError}
          </span>) : null}
          {tierMessage ? (<span
            className={styles.tierMessage}>
            {tierMessage}
          </span>) : null}
        </div>
      </div>

      {/* Levels grid: paginated table on the left, sticky
            editor on the right. `items-start` lets the sticky
            child stop at the top of the column instead of
            stretching to match the table's height. */}
      <div className={styles.levelsGrid}>
        <div>
          {/* Pagination controls */}
          <div className={styles.pagination}>
            <span className={styles.pageLabel}>
              Rows per page:
            </span>
            {pageSizeOptions.map((option) => (<button
              key={`page-size-${option}`}
              className={styles.pageSizeButton + " " + (levelsPageSize === option ? styles.pageSizeActive : styles.pageSizeInactive)}
              type="button"
              onClick={() => {
                setLevelsPageSize(option)
                setLevelsPageIndex(0)
              }}>
              {option === "all" ? "All" : option}
            </button>))}
            <span className={styles.pageNav}>
              <button
                className={styles.pageButton}
                disabled={clampedPageIndex === 0}
                type="button"
                onClick={() => {
                  setLevelsPageIndex(Math.max(0, clampedPageIndex - 1))
                }}>
                ‹ Prev
              </button>
              <span className={styles.pageCount}>
                {totalLevels === 0 ? "no rows" : `${pageStart + 1}–${pageEnd} of ${totalLevels}`}
              </span>
              <button
                className={styles.pageButton}
                disabled={clampedPageIndex >= totalPages - 1}
                type="button"
                onClick={() => {
                  setLevelsPageIndex(Math.min(totalPages - 1, clampedPageIndex + 1))
                }}>
                Next ›
              </button>
            </span>
          </div>
          <ConfigTable
            rows={pagedLevels.map((row) => {
              const rowMicros = usdMicrosFor(rateMap, "coins", row.reward_coins) + usdMicrosFor(rateMap, "gems", row.reward_gems)
              return [`Level ${row.level}`, resolveStatusLabel(row.level, parsedTierRanges, null), `${formatNumber(row.xp_required)} XP`, `${formatNumber(row.reward_coins)} coins · ${row.reward_gems} gems`, formatUsdMicros(rowMicros), row.is_enabled ? "Enabled" : "Disabled"]
            })}
            title="Levels"
            onRowClick={(index) => {
              setLevelDraft(levelToDraft(pagedLevels[index]))
            }}/>
        </div>
        <div className={styles.editorPanel}>
          <h2 className={styles.panelTitle}>Edit level</h2>
          <div className={styles.editorGrid}>
            <Field
              label="Level"
              value={levelDraft.level}
              onChange={(level) => {
                setLevelDraft((d) => ({
                  ...d,
                  level,
                }))
              }}/>
            <Field
              label="XP required"
              value={levelDraft.xp_required}
              onChange={(xp_required) => {
                setLevelDraft((d) => ({
                  ...d,
                  xp_required,
                }))
              }}/>
            <Field
              label="Status label (legacy)"
              value={levelDraft.status_label}
              onChange={(status_label) => {
                setLevelDraft((d) => ({
                  ...d,
                  status_label,
                }))
              }}/>
            <Field
              label="Reward coins"
              value={levelDraft.reward_coins}
              onChange={(reward_coins) => {
                setLevelDraft((d) => ({
                  ...d,
                  reward_coins,
                }))
              }}/>
            <Field
              label="Reward gems"
              value={levelDraft.reward_gems}
              onChange={(reward_gems) => {
                setLevelDraft((d) => ({
                  ...d,
                  reward_gems,
                }))
              }}/>
          </div>
          <p className={styles.editorNote}>
            "Status label" on a level row is legacy — the Status
            tiers panel above takes precedence in the lobby.
          </p>
          <div className={styles.editorBody}>
            <TextArea
              label="Reward items JSON array"
              value={levelDraft.reward_items}
              onChange={(reward_items) => {
                setLevelDraft((d) => ({
                  ...d,
                  reward_items,
                }))
              }}/>
            <TextArea
              label="Unlock rules JSON object"
              value={levelDraft.unlock_rules}
              onChange={(unlock_rules) => {
                setLevelDraft((d) => ({
                  ...d,
                  unlock_rules,
                }))
              }}/>
            <Toggle
              checked={levelDraft.is_enabled}
              label="Enabled"
              onChange={(is_enabled) => {
                setLevelDraft((d) => ({
                  ...d,
                  is_enabled,
                }))
              }}/>
            <div className={styles.editorActions}>
              <PrimaryButton
                disabled={!canManage || levelSaving}
                onClick={() => void saveLevel()}>Save
                level</PrimaryButton>
              <SecondaryButton
                onClick={newLevel}>
                New
              </SecondaryButton>
            </div>
          </div>
        </div>
      </div>
      <LevelCurveProposal
        canManage={canManage}
        coinValueMicros={rateMap.get("coins") ?? 100}
        currentLevels={levels}
        currentUserId={currentUserId}
        gemValueMicros={rateMap.get("gems") ?? 10000}
        onApplyCurve={applyCurve}
        onRecompute={recompute}/>
    </>)}
  </>)
}
