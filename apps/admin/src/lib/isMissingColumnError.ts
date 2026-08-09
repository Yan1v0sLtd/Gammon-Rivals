export function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as {code?: string, message?: string}
  const message = maybeError.message?.toLowerCase() ?? ""
  const normalizedColumnName = columnName.toLowerCase()
  return (message.includes(normalizedColumnName) && (maybeError.code === "42703" || maybeError.code === "PGRST204" || message.includes("schema cache") || message.includes("could not find")))
}
