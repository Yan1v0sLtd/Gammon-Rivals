import type {Database} from "../../../../packages/shared/src/database"

type EconomyGrant = Database["public"]["Tables"]["economy_grants"]["Row"]

export type EconomyGrantDraft = {
  trigger_key: string,
  display_name: string,
  description: string,
  coins: string,
  gems: string,
  one_time: boolean,
  is_enabled: boolean,
  sort_order: string,
  isNew: boolean,
}

export function grantToDraft(row?: EconomyGrant): EconomyGrantDraft {
  return {
    trigger_key: row?.trigger_key ?? "",
    display_name: row?.display_name ?? "",
    description: row?.description ?? "",
    coins: row?.coins.toString() ?? "0",
    gems: row?.gems.toString() ?? "0",
    one_time: row?.one_time ?? true,
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? "0",
    isNew: row === undefined,
  }
}
