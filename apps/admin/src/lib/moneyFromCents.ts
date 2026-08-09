export function moneyFromCents(value: number | null): string {
  if (value === null) return "Free"
  return `$${(value / 100).toFixed(2)}`
}
