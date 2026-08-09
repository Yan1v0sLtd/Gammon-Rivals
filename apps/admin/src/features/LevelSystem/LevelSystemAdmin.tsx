import {formatUsdMicros, type CurrencyRateMap, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import type {Database} from "../../../../../packages/shared/src/database"
import {resolveStatusLabel} from "../../../../../packages/shared/src/progression"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {LevelCurveProposal} from "../../components/LevelCurveProposal"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import {levelToDraft, type LevelDraft} from "../../lib/levelToDraft"

type LevelConfig = Database["public"]["Tables"]["level_configs"]["Row"]
type LevelStatusTierDraft = {
  id: string | null, level_from: string, level_to: string, label: string, sort_order: string, is_enabled: boolean,
}
type LevelsPageSize = 25 | 50 | 100 | "all"

type Props = {
  readonly levels: readonly LevelConfig[],
  readonly levelsPageSize: LevelsPageSize,
  readonly levelsPageIndex: number,
  readonly tierDrafts: readonly LevelStatusTierDraft[],
  readonly levelDraft: LevelDraft,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly savingTiers: boolean,
  readonly tierError: string | null,
  readonly tierMessage: string | null,
  readonly rateMap: CurrencyRateMap,
  readonly currentUserId: string | null,
  readonly onLevelsPageSizeChange: (size: LevelsPageSize) => void,
  readonly onLevelsPageIndexChange: (index: number) => void,
  readonly onUpdateTierDraft: (index: number, patch: Partial<LevelStatusTierDraft>) => void,
  readonly onRemoveTierDraft: (index: number) => void,
  readonly onAddBlankTier: () => void,
  readonly onSaveTiers: () => void,
  readonly onResetTierDrafts: () => void,
  readonly onLevelDraftChange: (patch: Partial<LevelDraft>) => void,
  readonly onSaveLevel: () => void,
  readonly onNewLevel: () => void,
  readonly onApplied: () => void | Promise<void>,
}

/**
 * Level System BO admin — the Status Tiers panel, the paginated Levels
 * table + editor, and the Level Curve proposal. Purely presentational:
 * it renders data the parent (Admin) already owns and forwards every
 * interaction back through explicit callbacks. No data fetching here.
 */
export function LevelSystemAdmin({
  levels,
  levelsPageSize,
  levelsPageIndex,
  tierDrafts,
  levelDraft,
  canManage,
  savingKey,
  savingTiers,
  tierError,
  tierMessage,
  rateMap,
  currentUserId,
  onLevelsPageSizeChange,
  onLevelsPageIndexChange,
  onUpdateTierDraft,
  onRemoveTierDraft,
  onAddBlankTier,
  onSaveTiers,
  onResetTierDrafts,
  onLevelDraftChange,
  onSaveLevel,
  onNewLevel,
  onApplied,
}: Props) {
  // Pagination math. `levels` is already sorted ascending by
  // level in loadAdminData. The page index is clamped to the
  // valid range so changing pageSize doesn't strand the user
  // on a phantom page.
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

  return (<>
    {/* Status Tiers — declarative level → rank label. The
            lobby derives status from these rows in real time,
            so changes here propagate without re-applying the
            curve or touching individual level rows. */}
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-black">Status tiers</h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
          declarative level → rank label
        </span>
      </div>
      <p className="mt-1 text-xs text-white/55">
        Map level ranges to a rank label (Rookie, Veteran, etc.).
        The lobby derives a player's displayed status from these
        tiers — so changing a range updates every level without
        re-applying the curve. Ranges may overlap; the lowest
        sort_order wins.
      </p>
      <div className="mt-4 space-y-2">
        {tierDrafts.length === 0 ? (<div
          className="rounded-lg border border-white/10 bg-black/20 px-4 py-6 text-center text-xs text-white/45">
          No tiers configured. Click "+ Add tier" to define your first range.
        </div>) : (<>
          <div
            className="grid grid-cols-[5rem_5rem_minmax(0,1fr)_5rem_5rem_2rem] gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
            <span>From</span>
            <span>To</span>
            <span>Label</span>
            <span>Sort</span>
            <span>Enabled</span>
            <span></span>
          </div>
          {tierDrafts.map((draft, i) => (<div
            key={`tier-${draft.id ?? `${draft.level_from}-${draft.level_to}-${draft.label}-${draft.sort_order}`}`}
            className="grid grid-cols-[5rem_5rem_minmax(0,1fr)_5rem_5rem_2rem] items-center gap-2">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
              min="1"
              type="number"
              value={draft.level_from}
              onChange={(e) => {
                onUpdateTierDraft(i, {level_from: e.target.value})
              }}/>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
              min="1"
              type="number"
              value={draft.level_to}
              onChange={(e) => {
                onUpdateTierDraft(i, {level_to: e.target.value})
              }}/>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-amber-200/60"
              placeholder="Rookie"
              type="text"
              value={draft.label}
              onChange={(e) => {
                onUpdateTierDraft(i, {label: e.target.value})
              }}/>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
              type="number"
              value={draft.sort_order}
              onChange={(e) => {
                onUpdateTierDraft(i, {sort_order: e.target.value})
              }}/>
            <label
              className="flex h-9 items-center justify-center rounded-lg border border-white/10 bg-black/20">
              <input
                checked={draft.is_enabled}
                className="h-4 w-4 accent-amber-300"
                type="checkbox"
                onChange={(e) => {
                  onUpdateTierDraft(i, {is_enabled: e.target.checked})
                }}/>
            </label>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/30 bg-rose-300/10 text-base font-black text-rose-200/80 transition hover:bg-rose-300/20"
              title="Remove tier"
              type="button"
              onClick={() => {
                onRemoveTierDraft(i)
              }}>
              ×
            </button>
          </div>))}
        </>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={onAddBlankTier}>+ Add tier</SecondaryButton>
        <PrimaryButton
          disabled={!canManage || savingTiers}
          onClick={onSaveTiers}>
          {savingTiers ? "Saving…" : "Save tiers"}
        </PrimaryButton>
        <SecondaryButton onClick={onResetTierDrafts}>Discard changes</SecondaryButton>
        {tierError ? (<span
          className="rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-1 text-xs font-bold text-rose-100">
          {tierError}
        </span>) : null}
        {tierMessage ? (<span
          className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-100">
          {tierMessage}
        </span>) : null}
      </div>
    </div>

    {/* Levels grid: paginated table on the left, sticky
            editor on the right. `items-start` lets the sticky
            child stop at the top of the column instead of
            stretching to match the table's height. */}
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div>
        {/* Pagination controls */}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-white/40 uppercase tracking-[0.14em] font-bold">
            Rows per page:
          </span>
          {pageSizeOptions.map((option) => (<button
            key={`page-size-${option}`}
            className={`rounded-md px-2.5 py-1 font-bold transition ${levelsPageSize === option ? "bg-amber-300/20 text-amber-100 border border-amber-200/40" : "bg-white/[0.04] text-white/55 border border-white/10 hover:border-white/25"}`}
            type="button"
            onClick={() => {
              onLevelsPageSizeChange(option)
              onLevelsPageIndexChange(0)
            }}>
            {option === "all" ? "All" : option}
          </button>))}
          <span className="ml-auto flex items-center gap-2 text-white/55">
            <button
              className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 disabled:opacity-40"
              disabled={clampedPageIndex === 0}
              type="button"
              onClick={() => {
                onLevelsPageIndexChange(Math.max(0, clampedPageIndex - 1))
              }}>
              ‹ Prev
            </button>
            <span className="font-mono text-white/70">
              {totalLevels === 0 ? "no rows" : `${pageStart + 1}–${pageEnd} of ${totalLevels}`}
            </span>
            <button
              className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 disabled:opacity-40"
              disabled={clampedPageIndex >= totalPages - 1}
              type="button"
              onClick={() => {
                onLevelsPageIndexChange(Math.min(totalPages - 1, clampedPageIndex + 1))
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
            onLevelDraftChange(levelToDraft(pagedLevels[index]))
          }}/>
      </div>
      <div className="sticky top-4 rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Edit level</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field
            label="Level"
            value={levelDraft.level}
            onChange={(level) => {
              onLevelDraftChange({level})
            }}/>
          <Field
            label="XP required"
            value={levelDraft.xp_required}
            onChange={(xp_required) => {
              onLevelDraftChange({xp_required})
            }}/>
          <Field
            label="Status label (legacy)"
            value={levelDraft.status_label}
            onChange={(status_label) => {
              onLevelDraftChange({status_label})
            }}/>
          <Field
            label="Reward coins"
            value={levelDraft.reward_coins}
            onChange={(reward_coins) => {
              onLevelDraftChange({reward_coins})
            }}/>
          <Field
            label="Reward gems"
            value={levelDraft.reward_gems}
            onChange={(reward_gems) => {
              onLevelDraftChange({reward_gems})
            }}/>
        </div>
        <p className="mt-2 text-[10px] text-white/35">
          "Status label" on a level row is legacy — the Status
          tiers panel above takes precedence in the lobby.
        </p>
        <div className="mt-3 space-y-3">
          <TextArea
            label="Reward items JSON array"
            value={levelDraft.reward_items}
            onChange={(reward_items) => {
              onLevelDraftChange({reward_items})
            }}/>
          <TextArea
            label="Unlock rules JSON object"
            value={levelDraft.unlock_rules}
            onChange={(unlock_rules) => {
              onLevelDraftChange({unlock_rules})
            }}/>
          <Toggle
            checked={levelDraft.is_enabled}
            label="Enabled"
            onChange={(is_enabled) => {
              onLevelDraftChange({is_enabled})
            }}/>
          <div className="flex gap-2">
            <PrimaryButton
              disabled={!canManage || savingKey === "level"}
              onClick={onSaveLevel}>Save
              level</PrimaryButton>
            <SecondaryButton
              onClick={onNewLevel}>
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
      onApplied={onApplied}/>
  </>)
}
