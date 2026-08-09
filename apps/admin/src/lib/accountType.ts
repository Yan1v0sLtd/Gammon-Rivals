import type {Database} from "../../../../packages/shared/src/database"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

export function accountType(row: ProfileRow): "Google" | "Guest" | "Test/Unknown" {
  if (row.is_guest) return "Guest"
  if (row.avatar_url) return "Google"
  return "Test/Unknown"
}
