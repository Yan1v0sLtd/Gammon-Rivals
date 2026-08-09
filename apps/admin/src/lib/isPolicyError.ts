export function isPolicyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as {code?: string, message?: string}
  return maybeError.code === "42501" || maybeError.message?.toLowerCase().includes("row-level security") === true
}
