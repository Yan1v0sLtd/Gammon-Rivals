import {useEffect, useState} from "react"

import {formatUsdMicros} from "../../../../../packages/shared/src/currency"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {Toggle} from "../../components/Toggle"
import {type CurrencyDraft, currencyToDraft} from "../../lib/currencyToDraft"
import {requiredNumber} from "../../lib/requiredNumber"

import styles from "./CurrenciesAdmin.module.css"
import {useGetCurrenciesQuery, useUpsertCurrencyMutation} from "./CurrenciesApi"

type Props = {
  readonly canManage: boolean,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Currencies BO admin — the currency config table + edit form.
 * Owns its own data: it fetches the currency rows via RTK Query, keeps
 * the editable draft in local state, and saves through the upsert
 * mutation. Query and mutation failures are reported up through
 * `onError` for page-level display. No direct Supabase calls here.
 */
export function CurrenciesAdmin({
  canManage,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: currencies = [],
    error: queryError,
  } = useGetCurrenciesQuery()
  const [upsertCurrency, {isLoading: saving}] = useUpsertCurrencyMutation()
  const [currencyDraft, setCurrencyDraft] = useState<CurrencyDraft>(() => currencyToDraft())

  // Surface a fetch failure through the page-level error reporter.
  useEffect(() => {
    if (queryError) onError(queryError)
  }, [queryError, onError])

  function selectCurrency(index: number) {
    setCurrencyDraft(currencyToDraft(currencies[index]))
  }

  function fieldChange(field: keyof CurrencyDraft, value: string) {
    setCurrencyDraft((d) => ({
      ...d,
      [field]: value,
    }))
  }

  function toggleEnabled(is_enabled: boolean) {
    setCurrencyDraft((d) => ({
      ...d,
      is_enabled,
    }))
  }

  function newCurrency() {
    setCurrencyDraft(currencyToDraft())
  }

  async function saveCurrency() {
    if (!canManage) return
    // Clear any stale page-level error before the save, mirroring the old
    // Admin handler's setDataError(null) so a fresh save doesn't leave a
    // previous failure on screen.
    onBeforeSave()
    try {
      const code = currencyDraft.code.trim()
      if (!code) throw new Error("Currency code is required.")
      if (!/^[a-z][a-z0-9_]*$/.test(code)) {
        throw new Error("Code must be lowercase letters, digits, or underscores, starting with a letter.")
      }
      const displayName = currencyDraft.display_name.trim()
      if (!displayName) throw new Error("Display name is required.")
      const usd = Number(currencyDraft.usd_value)
      if (!Number.isFinite(usd) || usd < 0) {
        throw new Error("USD value must be a non-negative number (e.g. 0.01).")
      }
      // Convert "$X.YZ" → micros. Round so 0.0001 doesn't drift to 99.
      const micros = Math.round(usd * 1_000_000)
      const sortOrder = requiredNumber(currencyDraft.sort_order, "Sort order")
      await upsertCurrency({
        p_code: code,
        p_display_name: displayName,
        p_usd_value_micros: micros,
        p_is_enabled: currencyDraft.is_enabled,
        p_sort_order: sortOrder,
      }).unwrap()
      setCurrencyDraft(currencyToDraft())
    }
    catch (err) {
      onError(err)
    }
  }

  return (<div className={styles.layout}>
    <ConfigTable
      rows={currencies.map((row) => [row.code, row.display_name, `$${(row.usd_value_micros / 1_000_000).toFixed(6)} / unit`, `100 = ${formatUsdMicros(row.usd_value_micros * 100)}`, row.is_enabled ? "Enabled" : "Disabled"])}
      title="Currencies"
      onRowClick={selectCurrency}/>
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>Edit currency</h2>
      <p className={styles.description}>
        USD value per single unit. The Hourly Wheel, Daily
        Bonus, and Level Rewards sections use
        these rates to show a $ value column. Add a new code
        (e.g. <code className={styles.mono}>chips</code>) when
        introducing a new currency. Disable instead of
        deleting — existing reward configs reference codes by
        name and would render as $0 if the code disappears.
      </p>
      <div className={styles.fieldGrid}>
        <Field
          label="Code"
          value={currencyDraft.code}
          onChange={(code) => {
            fieldChange("code", code)
          }}/>
        <Field
          label="Display name"
          value={currencyDraft.display_name}
          onChange={(display_name) => {
            fieldChange("display_name", display_name)
          }}/>
        <Field
          label="USD value per unit"
          value={currencyDraft.usd_value}
          onChange={(usd_value) => {
            fieldChange("usd_value", usd_value)
          }}/>
        <Field
          label="Sort order"
          value={currencyDraft.sort_order}
          onChange={(sort_order) => {
            fieldChange("sort_order", sort_order)
          }}/>
      </div>
      <p className={styles.hint}>
        Examples — 1 gem = $0.01 → type{" "}
        <code className={styles.mono}>0.01</code>. 1 coin =
        $0.0001 → type{" "}
        <code className={styles.mono}>0.0001</code>.
      </p>
      <div className={styles.formStack}>
        <Toggle
          checked={currencyDraft.is_enabled}
          label="Enabled"
          onChange={toggleEnabled}/>
        <div className={styles.buttonRow}>
          <PrimaryButton
            disabled={!canManage || saving}
            onClick={() => {
              void saveCurrency()
            }}>
            Save currency
          </PrimaryButton>
          <SecondaryButton onClick={newCurrency}>
            New
          </SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
