import type {Database} from "../../../../packages/shared/src/database"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

export function isDeletedProfile(row: ProfileRow): boolean {
  return (Boolean(row.deleted_at) || row.suspension_reason === "Deleted in Back Office" || row.admin_note?.includes("[Deleted in Back Office]") === true)
}
