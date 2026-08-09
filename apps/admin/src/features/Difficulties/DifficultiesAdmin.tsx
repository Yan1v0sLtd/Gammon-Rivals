import {formatUsdMicros, type CurrencyRateMap, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import {type TableDraft} from "../../lib/tableToDraft"

type TableConfig = Database["public"]["Tables"]["table_configs"]["Row"]

type Props = {
  readonly tables: readonly TableConfig[],
  readonly rateMap: CurrencyRateMap,
  readonly tableDraft: TableDraft,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly difficultyAccentColors: readonly string[],
  readonly onSelectDifficulty: (index: number) => void,
  readonly onTableDraftChange: (patch: Partial<TableDraft>) => void,
  readonly onSaveTable: () => void,
  readonly onNewDifficulty: () => void,
}

/**
 * Difficulties BO admin — the difficulty-tier table (kind='difficulty')
 * and the sticky editor for the selected tier. Purely presentational:
 * it renders data the parent (Admin) already owns and forwards every
 * interaction back through explicit callbacks. No data fetching here.
 */
export function DifficultiesAdmin({
  tables,
  rateMap,
  tableDraft,
  canManage,
  savingKey,
  difficultyAccentColors,
  onSelectDifficulty,
  onTableDraftChange,
  onSaveTable,
  onNewDifficulty,
}: Props) {
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
      onRowClick={onSelectDifficulty}/>
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h2 className="text-lg font-black">Edit difficulty</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Tier id"
          value={tableDraft.id}
          onChange={(id) => {
            onTableDraftChange({id})
          }}/>
        <Field
          label="Display name"
          value={tableDraft.display_name}
          onChange={(display_name) => {
            onTableDraftChange({display_name})
          }}/>
        <Field
          label="Entry fee (coins)"
          value={tableDraft.entry_fee_coins}
          onChange={(entry_fee_coins) => {
            onTableDraftChange({entry_fee_coins})
          }}/>
        <Field
          label="Prize coins (on win)"
          value={tableDraft.prize_coins}
          onChange={(prize_coins) => {
            onTableDraftChange({prize_coins})
          }}/>
        <Field
          label="Lose prize (consolation)"
          value={tableDraft.prize_coins_loss}
          onChange={(prize_coins_loss) => {
            onTableDraftChange({prize_coins_loss})
          }}/>
        <Field
          label="Target RTP (%)"
          value={tableDraft.target_rtp_pct}
          onChange={(target_rtp_pct) => {
            onTableDraftChange({target_rtp_pct})
          }}/>
        <Field
          label="XP boost (%)"
          value={tableDraft.xp_multiplier_pct}
          onChange={(xp_multiplier_pct) => {
            onTableDraftChange({xp_multiplier_pct})
          }}/>
        <Field
          label="Base XP per match"
          value={tableDraft.base_xp_win}
          onChange={(base_xp_win) => {
            onTableDraftChange({base_xp_win})
          }}/>
        <Field
          label="Turn seconds"
          value={tableDraft.turn_seconds}
          onChange={(turn_seconds) => {
            onTableDraftChange({turn_seconds})
          }}/>
        <Field
          label="Required level"
          value={tableDraft.required_level}
          onChange={(required_level) => {
            onTableDraftChange({required_level})
          }}/>
        <Field
          label="Match target"
          value={tableDraft.match_target}
          onChange={(match_target) => {
            onTableDraftChange({match_target})
          }}/>
        <Field
          label="Sort order"
          value={tableDraft.sort_order}
          onChange={(sort_order) => {
            onTableDraftChange({sort_order})
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
                onTableDraftChange({ai_level: event.target.value as "easy" | "medium" | "hard"})
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
                onTableDraftChange({accent_color: event.target.value})
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
            onTableDraftChange({description})
          }}/>
        <TextArea
          label="Metadata JSON object"
          value={tableDraft.metadata}
          onChange={(metadata) => {
            onTableDraftChange({metadata})
          }}/>
        <div className="grid grid-cols-3 gap-2">
          <Toggle
            checked={tableDraft.allow_ai}
            label="AI"
            onChange={(allow_ai) => {
              onTableDraftChange({allow_ai})
            }}/>
          <Toggle
            checked={tableDraft.allow_online}
            label="Online"
            onChange={(allow_online) => {
              onTableDraftChange({allow_online})
            }}/>
          <Toggle
            checked={tableDraft.is_enabled}
            label="Enabled"
            onChange={(is_enabled) => {
              onTableDraftChange({is_enabled})
            }}/>
        </div>
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || savingKey === "table"}
            onClick={onSaveTable}>Save
            tier</PrimaryButton>
          <SecondaryButton
            onClick={onNewDifficulty}>New</SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
