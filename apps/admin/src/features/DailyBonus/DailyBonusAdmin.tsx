import {formatUsdMicros, type CurrencyRateMap, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import type {DailyBonusDraft} from "../../lib/dailyBonusToDraft"
import {formatNumber} from "../../lib/formatNumber"

type DailyBonusConfig = Database["public"]["Tables"]["daily_bonus_configs"]["Row"]

type Props = {
  readonly dailyBonusConfigs: readonly DailyBonusConfig[],
  readonly dailyBonusDraft: DailyBonusDraft,
  readonly rateMap: CurrencyRateMap,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onSelectDay: (index: number) => void,
  readonly onFieldChange: (field: keyof DailyBonusDraft, value: string) => void,
  readonly onSave: () => void,
  readonly onReset: () => void,
}

/**
 * Daily Bonus BO admin — the 7-day reward table + edit form.
 * Purely presentational: it renders the rotating weekly cycle and the
 * coin/gem/XP editor from data the parent (Admin) already owns. No
 * data fetching here.
 */
export function DailyBonusAdmin({
  dailyBonusConfigs,
  dailyBonusDraft,
  rateMap,
  canManage,
  savingKey,
  onSelectDay,
  onFieldChange,
  onSave,
  onReset,
}: Props) {
  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <ConfigTable
      rows={dailyBonusConfigs.map((row) => {
        const rowMicros = usdMicrosFor(rateMap, "coins", row.reward_coins) + usdMicrosFor(rateMap, "gems", row.reward_gems)
        return [`Day ${row.day}`, `${formatNumber(row.reward_coins)} coins`, `${formatNumber(row.reward_gems)} gems`, `${formatNumber(row.reward_xp)} XP`, formatUsdMicros(rowMicros)]
      })}
      title="Daily bonus (7 days)"
      onRowClick={onSelectDay}/>
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h2 className="text-lg font-black">Edit daily bonus</h2>
      <p className="mt-1 text-xs text-white/55">
        Day 1–7 of the rotating weekly cycle. Streak resets to day 1
        if a player misses a day (ET calendar). After day 7 the cycle
        loops back to day 1.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Day (1–7)"
          value={dailyBonusDraft.day}
          onChange={(day) => {
            onFieldChange("day", day)
          }}/>
        <Field
          label="Reward coins"
          value={dailyBonusDraft.reward_coins}
          onChange={(reward_coins) => {
            onFieldChange("reward_coins", reward_coins)
          }}/>
        <Field
          label="Reward gems"
          value={dailyBonusDraft.reward_gems}
          onChange={(reward_gems) => {
            onFieldChange("reward_gems", reward_gems)
          }}/>
        <Field
          label="Reward XP"
          value={dailyBonusDraft.reward_xp}
          onChange={(reward_xp) => {
            onFieldChange("reward_xp", reward_xp)
          }}/>
      </div>
      <div className="mt-3 space-y-3">
        <TextArea
          label="Reward items JSON array"
          value={dailyBonusDraft.reward_items}
          onChange={(reward_items) => {
            onFieldChange("reward_items", reward_items)
          }}/>
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || savingKey === "daily-bonus"}
            onClick={onSave}>
            Save day
          </PrimaryButton>
          <SecondaryButton onClick={onReset}>
            Reset form
          </SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
