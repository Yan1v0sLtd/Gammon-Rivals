import type {CurrencyConfigRow} from "../../../../packages/shared/src/currency"

export type CurrencyDraft = {
  code: string,
  display_name: string, // USD value of one unit, as a free-text decimal string. Converted to
  // micros (USD × 1_000_000) on save so the operator can type e.g.
  // "0.01" without thinking about the storage representation.
  usd_value: string,
  is_enabled: boolean,
  sort_order: string,
}

export function currencyToDraft(row?: CurrencyConfigRow): CurrencyDraft {
  return {
    code: row?.code ?? "",
    display_name: row?.display_name ?? "", // Show the value in plain USD (e.g. "0.01"). Six decimals covers
    // sub-cent rates (1 coin = $0.0001) without scientific notation.
    usd_value: row ? (row.usd_value_micros / 1_000_000).toFixed(6) : "",
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? "0",
  }
}
