import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"
import {isDeletedProfile} from "../../lib/isDeletedProfile"

export type DashboardStats = {
  users: number,
  suspendedUsers: number,
  matches: number,
  activeMatches: number,
  shopItems: number,
}

const emptyStats: DashboardStats = {
  users: 0,
  suspendedUsers: 0,
  matches: 0,
  activeMatches: 0,
  shopItems: 0,
}

/**
 * The Dashboard's headline counts — a single summary read batching the
 * head counts the legacy loadAdminData computed in its Promise.all.
 *
 * The Users count deliberately mirrors the legacy behavior: it counts
 * the non-deleted rows among the latest 120 profiles, NOT the true
 * total (the old exact head count was dead code because the filtered
 * row-array length is always defined). Preserved for behavior parity.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  if (!isAdminSupabaseConfigured) return emptyStats
  const [userCount, suspendedCount, matchCount, activeMatchCount, profilesResult, shopCount] = await Promise.all([adminSupabase.from("profiles").select("id", {
    count: "exact",
    head: true,
  }), adminSupabase
    .from("profiles")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("is_suspended", true), adminSupabase.from("matches").select("id", {
    count: "exact",
    head: true,
  }), adminSupabase.from("matches").select("id", {
    count: "exact",
    head: true,
  }).is("finished_at", null), adminSupabase
    .from("profiles")
    .select("*")
    .order("created_at", {ascending: false})
    .limit(120), adminSupabase.from("shop_items").select("id", {
    count: "exact",
    head: true,
  })])
  const firstError = userCount.error ?? suspendedCount.error ?? matchCount.error ?? activeMatchCount.error ?? profilesResult.error ?? shopCount.error
  if (firstError) throw firstError

  return {
    users: (profilesResult.data ?? []).filter((row) => !isDeletedProfile(row)).length,
    suspendedUsers: suspendedCount.count ?? 0,
    matches: matchCount.count ?? 0,
    activeMatches: activeMatchCount.count ?? 0,
    shopItems: shopCount.count ?? 0,
  }
}
