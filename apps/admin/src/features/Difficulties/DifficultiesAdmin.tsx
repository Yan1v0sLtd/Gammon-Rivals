import {useEffect, useMemo, useState} from "react"

import {buildCurrencyRateMap, formatUsdMicros, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import {parseJson} from "../../lib/parseJson"
import {requiredNumber} from "../../lib/requiredNumber"
import {type TableDraft, tableToDraft} from "../../lib/tableToDraft"
import {useGetCurrenciesQuery} from "../Currencies/CurrenciesApi"

import {useGetTablesQuery, useUpsertTableMutation} from "./DifficultiesApi"
import type {TableConfigInsert} from "./DifficultiesData"

/** Accent slugs the DifficultyModal recognises. The BO dropdown is
 *  scoped to these so an operator can't accidentally set an unknown
 *  slug and ship a card with no colour. */
const difficultyAccentColors: readonly string[] = ["green", "blue", "purple", "red", "gold"]

type Props = {
  readonly canManage: boolean,
  readonly updatedBy: string | null,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Difficulties BO admin — the difficulty-tier table (kind='difficulty')
 * and the sticky editor for the selected tier. Owns its own data: it
 * fetches the tiers via RTK Query, keeps the editable draft in local
 * state, and saves through the upsert mutation. Query and mutation
 * failures are reported up through `onError` for page-level display.
 * No direct Supabase calls here.
 */
export function DifficultiesAdmin({
  canManage,
  updatedBy,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: tables = [],
    error: tablesError,
  } = useGetTablesQuery()
  const [upsertTable, {isLoading: saving}] = useUpsertTableMutation()
  // Currencies feed the $ value columns in the tier table.
  const {
    data: currencies = [],
  } = useGetCurrenciesQuery()
  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies])
  const [tableDraft, setTableDraft] = useState<TableDraft>(() => tableToDraft())

  // Surface a fetch failure through the page-level error reporter.
  useEffect(() => {
    if (tablesError) onError(tablesError)
  }, [tablesError, onError])

  function selectDifficulty(index: number) {
    const diffRows = tables.filter((row) => row.kind === "difficulty")
    setTableDraft(tableToDraft(diffRows[index], "difficulty"))
  }

  function newDifficulty() {
    setTableDraft(tableToDraft(undefined, "difficulty"))
  }

  function updateDraft(patch: Partial<TableDraft>) {
    setTableDraft((d) => ({
      ...d, ...patch,
    }))
  }

  async function saveTable() {
    if (!canManage) return
    // Clear any stale page-level error before the save, mirroring the old
    // Admin handler's setDataError(null) so a fresh save doesn't leave a
    // previous failure on screen.
    onBeforeSave()
    try {
      const xpMult = requiredNumber(tableDraft.xp_multiplier_pct, "XP multiplier")
      if (xpMult < 0 || xpMult > 10000) {
        throw new Error("XP multiplier must be between 0 and 10000.")
      }
      const turnSec = requiredNumber(tableDraft.turn_seconds, "Turn seconds")
      if (turnSec < 5 || turnSec > 600) {
        throw new Error("Turn seconds must be between 5 and 600.")
      }
      const targetRtp = requiredNumber(tableDraft.target_rtp_pct, "Target RTP")
      if (targetRtp < 0 || targetRtp > 200) {
        throw new Error("Target RTP must be between 0 and 200.")
      }
      const payload: TableConfigInsert = {
        id: tableDraft.id.trim(),
        kind: tableDraft.kind,
        display_name: tableDraft.display_name.trim(),
        description: tableDraft.description.trim(),
        entry_fee_coins: requiredNumber(tableDraft.entry_fee_coins, "Entry fee"),
        prize_coins: requiredNumber(tableDraft.prize_coins, "Prize"),
        prize_coins_loss: requiredNumber(tableDraft.prize_coins_loss, "Lose prize"),
        required_level: requiredNumber(tableDraft.required_level, "Required level"),
        match_target: requiredNumber(tableDraft.match_target, "Match target"),
        allow_ai: tableDraft.allow_ai,
        allow_online: tableDraft.allow_online,
        is_enabled: tableDraft.is_enabled,
        sort_order: requiredNumber(tableDraft.sort_order, "Sort order"),
        xp_multiplier_pct: xpMult,
        base_xp_win: requiredNumber(tableDraft.base_xp_win, "Base XP"),
        turn_seconds: turnSec,
        accent_color: tableDraft.accent_color.trim() || "gold",
        ai_level: tableDraft.ai_level,
        target_rtp_pct: targetRtp,
        metadata: parseJson(tableDraft.metadata, "Metadata", "object"),
        updated_by: updatedBy,
      }
      await upsertTable(payload).unwrap()
      setTableDraft(tableToDraft())
    }
    catch (err) {
      onError(err)
    }
  }

  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
    {/* Difficulty-tier table. These rows surface in the
          * lobby's "Select Room Difficulty" modal (filtered by
          * kind='difficulty' + is_enabled). XP boost % drives
          * both the card display and the actual XP grant at
          * match end via finish_match(). */}
    <ConfigTable
      rows={tables.filter((row) => row.kind === "difficulty").map((row) => {
        const feeMicros = usdMicrosFor(rateMap, "coins", row.entry_fee_coins)
        const winMicros = usdMicrosFor(rateMap, "coins", row.prize_coins)
        const lossMicros = usdMicrosFor(rateMap, "coins", row.prize_coins_loss)
        return [row.display_name, `${row.xp_multiplier_pct}% XP`, `Fee ${formatNumber(row.entry_fee_coins)}`, `W ${formatNumber(row.prize_coins)} / L ${formatNumber(row.prize_coins_loss)}`, `AI ${row.ai_level}`, `RTP ${row.target_rtp_pct}%`, `Fee ${formatUsdMicros(feeMicros)} · W ${formatUsdMicros(winMicros)} · L ${formatUsdMicros(lossMicros)}`, row.is_enabled ? "Enabled" : "Disabled"]
      })}
      title="Difficulty tiers"
      onRowClick={selectDifficulty}/>
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h2 className="text-lg font-black">Edit difficulty</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Tier id"
          value={tableDraft.id}
          onChange={(id) => {
            updateDraft({id})
          }}/>
        <Field
          label="Display name"
          value={tableDraft.display_name}
          onChange={(display_name) => {
            updateDraft({display_name})
          }}/>
        <Field
          label="Entry fee (coins)"
          value={tableDraft.entry_fee_coins}
          onChange={(entry_fee_coins) => {
            updateDraft({entry_fee_coins})
          }}/>
        <Field
          label="Prize coins (on win)"
          value={tableDraft.prize_coins}
          onChange={(prize_coins) => {
            updateDraft({prize_coins})
          }}/>
        <Field
          label="Lose prize (consolation)"
          value={tableDraft.prize_coins_loss}
          onChange={(prize_coins_loss) => {
            updateDraft({prize_coins_loss})
          }}/>
        <Field
          label="Target RTP (%)"
          value={tableDraft.target_rtp_pct}
          onChange={(target_rtp_pct) => {
            updateDraft({target_rtp_pct})
          }}/>
        <Field
          label="XP boost (%)"
          value={tableDraft.xp_multiplier_pct}
          onChange={(xp_multiplier_pct) => {
            updateDraft({xp_multiplier_pct})
          }}/>
        <Field
          label="Base XP per match"
          value={tableDraft.base_xp_win}
          onChange={(base_xp_win) => {
            updateDraft({base_xp_win})
          }}/>
        <Field
          label="Turn seconds"
          value={tableDraft.turn_seconds}
          onChange={(turn_seconds) => {
            updateDraft({turn_seconds})
          }}/>
        <Field
          label="Required level"
          value={tableDraft.required_level}
          onChange={(required_level) => {
            updateDraft({required_level})
          }}/>
        <Field
          label="Match target"
          value={tableDraft.match_target}
          onChange={(match_target) => {
            updateDraft({match_target})
          }}/>
        <Field
          label="Sort order"
          value={tableDraft.sort_order}
          onChange={(sort_order) => {
            updateDraft({sort_order})
          }}/>
      </div>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
            AI strength
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60"
              value={tableDraft.ai_level}
              onChange={(event) => {
                updateDraft({ai_level: event.target.value as "easy" | "medium" | "hard"})
              }}>
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
            Accent color
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60"
              value={tableDraft.accent_color}
              onChange={(event) => {
                updateDraft({accent_color: event.target.value})
              }}>
              {difficultyAccentColors.map((slug) => (<option
                key={slug}
                value={slug}>{slug}</option>))}
            </select>
          </label>
        </div>
        <Field
          label="Description"
          value={tableDraft.description}
          onChange={(description) => {
            updateDraft({description})
          }}/>
        <TextArea
          label="Metadata JSON object"
          value={tableDraft.metadata}
          onChange={(metadata) => {
            updateDraft({metadata})
          }}/>
        <div className="grid grid-cols-3 gap-2">
          <Toggle
            checked={tableDraft.allow_ai}
            label="AI"
            onChange={(allow_ai) => {
              updateDraft({allow_ai})
            }}/>
          <Toggle
            checked={tableDraft.allow_online}
            label="Online"
            onChange={(allow_online) => {
              updateDraft({allow_online})
            }}/>
          <Toggle
            checked={tableDraft.is_enabled}
            label="Enabled"
            onChange={(is_enabled) => {
              updateDraft({is_enabled})
            }}/>
        </div>
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || saving}
            onClick={() => void saveTable()}>Save
            tier</PrimaryButton>
          <SecondaryButton
            onClick={newDifficulty}>New</SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
