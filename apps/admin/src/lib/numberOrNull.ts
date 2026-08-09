export function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error("Number field is invalid.")
  return parsed
}
