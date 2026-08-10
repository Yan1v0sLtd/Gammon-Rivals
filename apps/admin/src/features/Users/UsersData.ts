import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase as supabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"
import {emptyToNull} from "../../lib/emptyToNull"
import {isDeletedProfile} from "../../lib/isDeletedProfile"
import {isMissingAnyColumnError} from "../../lib/isMissingAnyColumnError"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
type UserWallet = Database["public"]["Tables"]["user_wallets"]["Row"]
type WalletTransaction = Database["public"]["Tables"]["wallet_transactions"]["Row"]
type UserBoardInventory = Database["public"]["Tables"]["user_board_inventory"]["Row"]
type Purchase = Database["public"]["Tables"]["purchases"]["Row"]

export type AdminUser = {
  wallet?: UserWallet,
} & ProfileRow

export type UserDetail = {
  wallet: UserWallet | null,
  transactions: WalletTransaction[],
  boards: UserBoardInventory[],
  purchases: Purchase[],
  matches: Database["public"]["Tables"]["matches"]["Row"][],
}

export type ProfileDraft = {
  level: string,
  xp: string,
  rating: string,
  admin_note: string,
  suspension_reason: string,
}

export type WalletDraft = {
  currency: string,
  amount: string,
  reason: string,
}

export type UpdateProfilePayload = {
  userId: string,
  payload: Database["public"]["Tables"]["profiles"]["Update"],
}

export type ToggleSuspensionPayload = {
  targetProfileId: string,
  isSuspended: boolean,
  suspensionReason: string | null,
}

export type AdjustWalletPayload = {
  targetProfileId: string,
  currencyCode: string,
  deltaAmount: number,
  adjustmentReason: string,
}

export type SoftDeletePayload = {
  profileIds: string[],
  note: string,
  deletedBy: string | null,
}

/**
 * The live user directory: the latest 120 profiles (by creation) with
 * their wallets attached. The 120-row cap is legacy behavior — there is
 * no true head count (the Dashboard's "Users" card counts this same
 * window). Deleted rows are excluded. Read guard: the Users section only
 * mounts after the access gate, so an unconfigured Supabase is an empty
 * list, not a failure.
 */
export async function fetchUsers(): Promise<AdminUser[]> {
  if (!isAdminSupabaseConfigured) return []
  const profilesResult = await supabase.from("profiles").select("*").order("created_at", {ascending: false}).limit(120)
  if (profilesResult.error) throw profilesResult.error

  const profileRows = (profilesResult.data ?? []).filter((row) => !isDeletedProfile(row))
  const profileIds = profileRows.map((row) => row.id)
  const wallets = profileIds.length ? await supabase.from("user_wallets").select("*").in("profile_id", profileIds) : {
    data: [],
    error: null,
  }
  if (wallets.error) throw wallets.error

  const walletMap = new Map((wallets.data ?? []).map((wallet) => [wallet.profile_id, wallet]))
  return profileRows.map((row) => ({
    ...row,
    wallet: walletMap.get(row.id),
  }))
}

/**
 * The full inspector for one user: wallet, last 12 wallet transactions,
 * owned boards, last 12 purchases, and last 12 matches (as either side).
 * One query per selection — RTK Query caches it by profile id.
 */
export async function fetchUserDetail(profileId: string): Promise<UserDetail> {
  if (!isAdminSupabaseConfigured) return {
    wallet: null,
    transactions: [],
    boards: [],
    purchases: [],
    matches: [],
  }
  const [wallet, transactions, boardsOwned, purchases, matches] = await Promise.all([supabase
    .from("user_wallets")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle(), supabase
    .from("wallet_transactions")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", {ascending: false})
    .limit(12), supabase
    .from("user_board_inventory")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", {ascending: false}), supabase
    .from("purchases")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", {ascending: false})
    .limit(12), supabase
    .from("matches")
    .select("*")
    .or(`owner_id.eq.${profileId},opponent_id.eq.${profileId}`)
    .order("started_at", {ascending: false})
    .limit(12)])

  const firstError = wallet.error ?? transactions.error ?? boardsOwned.error ?? purchases.error ?? matches.error
  if (firstError) throw firstError

  return {
    wallet: wallet.data,
    transactions: transactions.data ?? [],
    boards: boardsOwned.data ?? [],
    purchases: purchases.data ?? [],
    matches: matches.data ?? [],
  }
}

export async function updateProfile({
  userId,
  payload,
}: UpdateProfilePayload): Promise<void> {
  const {error} = await supabase.from("profiles").update(payload).eq("id", userId)
  if (error) throw error
}

export async function toggleSuspension({
  targetProfileId,
  isSuspended,
  suspensionReason,
}: ToggleSuspensionPayload): Promise<void> {
  const {error} = await supabase
    .from("profiles")
    .update({
      is_suspended: isSuspended,
      suspended_at: isSuspended ? new Date().toISOString() : null,
      suspension_reason: suspensionReason,
    })
    .eq("id", targetProfileId)
  if (error) throw error
}

export async function adjustWallet({
  targetProfileId,
  currencyCode,
  deltaAmount,
  adjustmentReason,
}: AdjustWalletPayload): Promise<void> {
  const {error} = await supabase.rpc("admin_adjust_wallet", {
    target_profile_id: targetProfileId,
    currency_code: currencyCode,
    delta_amount: deltaAmount,
    adjustment_reason: adjustmentReason,
  })
  if (error) throw error
}

/**
 * Soft delete — marks the rows deleted (deleted_at / deleted_by /
 * delete_note) and suspends the account. Older databases without the
 * delete columns fall back to the pre-column payload; that path was
 * added when the columns were introduced, so keep it for parity.
 */
export async function softDeleteUsers({
  profileIds,
  note,
  deletedBy,
}: SoftDeletePayload): Promise<void> {
  const deletePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
    deleted_at: new Date().toISOString(),
    deleted_by: deletedBy,
    delete_note: emptyToNull(note) ?? "Back Office soft delete",
    is_suspended: true,
    suspended_at: new Date().toISOString(),
    suspension_reason: "Deleted in Back Office",
    admin_note: `[Deleted in Back Office] ${emptyToNull(note) ?? "Soft delete"}`,
  }
  const {
    data: deletedRows,
    error,
  } = await supabase
    .from("profiles")
    .update(deletePayload)
    .in("id", profileIds)
    .is("deleted_at", null)
    .select("id")
  if (isMissingAnyColumnError(error, ["deleted_at", "deleted_by", "delete_note"])) {
    const fallbackPayload = {...deletePayload}
    delete fallbackPayload.deleted_at
    delete fallbackPayload.deleted_by
    delete fallbackPayload.delete_note
    const fallback = await supabase
      .from("profiles")
      .update(fallbackPayload)
      .in("id", profileIds)
      .select("id")
    if (fallback.error) throw fallback.error
    if ((fallback.data ?? []).length === 0) {
      throw new Error("No users were deleted. Check that your admin email has owner/admin permissions.")
    }
  }
  else if (error) {
    throw error
  }
  else if ((deletedRows ?? []).length === 0) {
    throw new Error("No users were deleted. Check that your admin email has owner/admin permissions.")
  }
}

/**
 * Hard delete (irreversible) — calls the admin_hard_delete_user RPC
 * which removes the auth.users row + cascades through everything.
 * Intended for shell/test users that pile up during dev. Guarded by a
 * type-to-confirm prompt in the component because there's no undo.
 */
export async function hardDeleteUsers(profileIds: string[]): Promise<void> {
  // Loop sequentially so an error on one row surfaces with the
  // matching id; .rpc() doesn't have a batch form for this.
  for (const id of profileIds) {
    const {error} = await supabase.rpc("admin_hard_delete_user", {target_id: id})
    if (error) throw new Error(`${id.slice(0, 8)}…: ${error.message}`)
  }
}
