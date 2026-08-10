export function isMissingMigrationError(error: {
  code?: string,
  message?: string,
} | null): boolean {
  if (!error) return false
  return (error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205" || error.message?.includes("Could not find the function") === true || error.message?.includes("Could not find the table") === true || error.message?.includes("relation") === true || error.message?.includes("column") === true)
}
