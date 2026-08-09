import {formatUsdMicros, type CurrencyConfigRow} from "../../../../../packages/shared/src/currency"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {Toggle} from "../../components/Toggle"
import type {CurrencyDraft} from "../../lib/currencyToDraft"

type Props = {
  readonly currencies: readonly CurrencyConfigRow[],
  readonly currencyDraft: CurrencyDraft,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onSelectCurrency: (index: number) => void,
  readonly onFieldChange: (field: keyof CurrencyDraft, value: string) => void,
  readonly onToggleEnabled: (is_enabled: boolean) => void,
  readonly onSave: () => void,
  readonly onNew: () => void,
}

/**
 * Currencies BO admin — the currency config table + edit form.
 * Purely presentational: it renders the list of currency codes and the
 * USD-value / sort-order editor from data the parent (Admin) already
 * owns. No data fetching here.
 */
export function CurrenciesAdmin({
  currencies,
  currencyDraft,
  canManage,
  savingKey,
  onSelectCurrency,
  onFieldChange,
  onToggleEnabled,
  onSave,
  onNew,
}: Props) {
  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <ConfigTable
      rows={currencies.map((row) => [row.code, row.display_name, `$${(row.usd_value_micros / 1_000_000).toFixed(6)} / unit`, `100 = ${formatUsdMicros(row.usd_value_micros * 100)}`, row.is_enabled ? "Enabled" : "Disabled"])}
      title="Currencies"
      onRowClick={onSelectCurrency}/>
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h2 className="text-lg font-black">Edit currency</h2>
      <p className="mt-1 text-xs text-white/55">
        USD value per single unit. The Hourly Wheel, Daily
        Bonus, and Level Rewards sections use
        these rates to show a $ value column. Add a new code
        (e.g. <code className="font-mono">chips</code>) when
        introducing a new currency. Disable instead of
        deleting — existing reward configs reference codes by
        name and would render as $0 if the code disappears.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Code"
          value={currencyDraft.code}
          onChange={(code) => {
            onFieldChange("code", code)
          }}/>
        <Field
          label="Display name"
          value={currencyDraft.display_name}
          onChange={(display_name) => {
            onFieldChange("display_name", display_name)
          }}/>
        <Field
          label="USD value per unit"
          value={currencyDraft.usd_value}
          onChange={(usd_value) => {
            onFieldChange("usd_value", usd_value)
          }}/>
        <Field
          label="Sort order"
          value={currencyDraft.sort_order}
          onChange={(sort_order) => {
            onFieldChange("sort_order", sort_order)
          }}/>
      </div>
      <p className="mt-2 text-[10px] normal-case tracking-normal text-white/40">
        Examples — 1 gem = $0.01 → type{" "}
        <code className="font-mono">0.01</code>. 1 coin =
        $0.0001 → type{" "}
        <code className="font-mono">0.0001</code>.
      </p>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={currencyDraft.is_enabled}
          label="Enabled"
          onChange={onToggleEnabled}/>
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || savingKey === "currency"}
            onClick={onSave}>
            Save currency
          </PrimaryButton>
          <SecondaryButton onClick={onNew}>
            New
          </SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
