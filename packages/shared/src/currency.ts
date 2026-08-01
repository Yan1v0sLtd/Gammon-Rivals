import type { Database } from './database';

export type CurrencyConfigRow = Database['public']['Tables']['currency_configs']['Row'];

// Map<code, usd_value_micros> for O(1) lookups when building $ columns
// over reward lists. Disabled currencies are dropped so the BO can hide
// a currency from $ math without deleting its row.
export type CurrencyRateMap = ReadonlyMap<string, number>;

export function buildCurrencyRateMap(
  rows: readonly CurrencyConfigRow[],
): CurrencyRateMap {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.is_enabled) map.set(row.code, row.usd_value_micros);
  }
  return map;
}

// USD value in micros for a (currency, amount) pair. Returns 0 when the
// currency code isn't in the rate map — that's the intended path for XP
// (we deliberately don't price progression metrics) and for any future
// currency the operator hasn't added yet.
export function usdMicrosFor(
  rates: CurrencyRateMap,
  currency: string | null | undefined,
  amount: number | null | undefined,
): number {
  if (!currency || amount == null) return 0;
  const micros = rates.get(currency);
  if (micros == null) return 0;
  return micros * amount;
}

// Format micros as "$X.YZ". Default precision is 2 decimals — what the
// operator wants for raw reward values. The "<$0.01" floor avoids a
// misleading "$0.00" on rewards that have real (if tiny) value, e.g. a
// single coin at $0.0001. Pass {precision: 4} on probability-weighted
// EV totals where rows commonly round down past two decimals.
export function formatUsdMicros(
  micros: number,
  opts: { precision?: 2 | 4 } = {},
): string {
  const precision = opts.precision ?? 2;
  const value = micros / 1_000_000;
  if (value === 0) return '$0.00';
  if (precision === 2 && value > 0 && value < 0.005) return '<$0.01';
  if (precision === 2 && value < 0 && value > -0.005) return '>-$0.01';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}
