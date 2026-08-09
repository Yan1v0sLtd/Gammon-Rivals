import {useEffect, useState} from "react"

import {formatUsdMicros, type CurrencyRateMap, usdMicrosFor} from "../../../../../packages/shared/src/currency"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {dailyBonusToDraft, type DailyBonusDraft} from "../../lib/dailyBonusToDraft"
import {formatNumber} from "../../lib/formatNumber"
import {parseJson} from "../../lib/parseJson"
import {requiredNumber} from "../../lib/requiredNumber"

import {
  useGetDailyBonusQuery,
  useUpsertDailyBonusMutation,
} from "./DailyBonusApi"

type Props = {
  readonly rateMap: CurrencyRateMap,
  readonly canManage: boolean,
  readonly updatedBy: string | null,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Daily Bonus BO admin — the 7-day reward table + edit form.
 * Owns its own data: it fetches the config rows via RTK Query, keeps
 * the editable draft in local state, and saves through the upsert
 * mutation. Query and mutation failures are reported up through
 * `onError` for page-level display. No direct Supabase calls here.
 */
export function DailyBonusAdmin({
  rateMap,
  canManage,
  updatedBy,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: dailyBonusConfigs = [],
    error: queryError,
  } = useGetDailyBonusQuery()
  const [upsertDailyBonus, {isLoading: saving}] = useUpsertDailyBonusMutation()
  const [dailyBonusDraft, setDailyBonusDraft] = useState<DailyBonusDraft>(() => dailyBonusToDraft())

  // Surface a fetch failure through the page-level error reporter.
  useEffect(() => {
    if (queryError) onError(queryError)
  }, [queryError, onError])

  function selectDay(index: number) {
    setDailyBonusDraft(dailyBonusToDraft(dailyBonusConfigs[index]))
  }

  function fieldChange(field: keyof DailyBonusDraft, value: string) {
    setDailyBonusDraft((d) => ({
      ...d,
      [field]: value,
    }))
  }

  function resetForm() {
    setDailyBonusDraft(dailyBonusToDraft())
  }

  async function saveDailyBonus() {
    if (!canManage) return
    // Clear any stale page-level error before the save, mirroring the old
    // Admin handler's setDataError(null) so a fresh save doesn't leave a
    // previous failure on screen.
    onBeforeSave()
    try {
      const day = requiredNumber(dailyBonusDraft.day, "Day")
      if (day < 1 || day > 7) throw new Error("Day must be between 1 and 7.")
      await upsertDailyBonus({
        day,
        reward_coins: requiredNumber(dailyBonusDraft.reward_coins, "Reward coins"),
        reward_gems: requiredNumber(dailyBonusDraft.reward_gems, "Reward gems"),
        reward_xp: requiredNumber(dailyBonusDraft.reward_xp, "Reward XP"),
        reward_items: parseJson(dailyBonusDraft.reward_items, "Reward items", "array"),
        updated_by: updatedBy,
      }).unwrap()
      setDailyBonusDraft(dailyBonusToDraft())
    }
    catch (err) {
      onError(err)
    }
  }

  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <ConfigTable
      rows={dailyBonusConfigs.map((row) => {
        const rowMicros = usdMicrosFor(rateMap, "coins", row.reward_coins) + usdMicrosFor(rateMap, "gems", row.reward_gems)
        return [`Day ${row.day}`, `${formatNumber(row.reward_coins)} coins`, `${formatNumber(row.reward_gems)} gems`, `${formatNumber(row.reward_xp)} XP`, formatUsdMicros(rowMicros)]
      })}
      title="Daily bonus (7 days)"
      onRowClick={selectDay}/>
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
            fieldChange("day", day)
          }}/>
        <Field
          label="Reward coins"
          value={dailyBonusDraft.reward_coins}
          onChange={(reward_coins) => {
            fieldChange("reward_coins", reward_coins)
          }}/>
        <Field
          label="Reward gems"
          value={dailyBonusDraft.reward_gems}
          onChange={(reward_gems) => {
            fieldChange("reward_gems", reward_gems)
          }}/>
        <Field
          label="Reward XP"
          value={dailyBonusDraft.reward_xp}
          onChange={(reward_xp) => {
            fieldChange("reward_xp", reward_xp)
          }}/>
      </div>
      <div className="mt-3 space-y-3">
        <TextArea
          label="Reward items JSON array"
          value={dailyBonusDraft.reward_items}
          onChange={(reward_items) => {
            fieldChange("reward_items", reward_items)
          }}/>
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || saving}
            onClick={() => {
              void saveDailyBonus()
            }}>
            Save day
          </PrimaryButton>
          <SecondaryButton onClick={resetForm}>
            Reset form
          </SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
