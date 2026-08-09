export function requiredNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`)
  return parsed
}
