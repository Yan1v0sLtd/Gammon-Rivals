import type {Database} from "../../../../../packages/shared/src/database"
import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

/**
 * Admin Access reads + writes. Audit rows for `admin_roles` and
 * `admin_email_allowlist` writes are created automatically by database
 * triggers — no explicit audit insert happens here, and the audit feed is
 * read-only state for the Dashboard and Admin Access sections.
 */
export type AdminRoleRow = Database["public"]["Tables"]["admin_roles"]["Row"]
export type AdminEmailRoleRow = Database["public"]["Tables"]["admin_email_allowlist"]["Row"]
export type AuditEntryRow = Database["public"]["Tables"]["admin_audit_log"]["Row"]
export type AdminRole = AdminRoleRow["role"]

export type UpsertAdminRoleArgs = {
  profile_id: string,
  role: AdminRole,
  note: string | null,
  created_by: string | null,
}

export type UpsertAdminEmailRoleArgs = {
  email: string,
  role: AdminRole,
  note: string | null,
  created_by: string | null,
}

/**
 * The full admin roles table, newest first — the gating fetch that drives the
 * Admin Access section's role list, so its errors must surface. An empty
 * result (or an unconfigured Supabase) is a legitimately empty table, not a
 * failure.
 */
export async function fetchAdminRoles(): Promise<readonly AdminRoleRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("admin_roles")
    .select("*")
    .order("created_at", {ascending: false})
  if (error) throw error
  return data ?? []
}

/**
 * The full admin email allowlist, newest first — the gating fetch that drives
 * the Admin Access section's allowlist, so its errors must surface.
 */
export async function fetchAdminEmailRoles(): Promise<readonly AdminEmailRoleRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("admin_email_allowlist")
    .select("*")
    .order("created_at", {ascending: false})
  if (error) throw error
  return data ?? []
}

/**
 * The most recent 20 audit entries — the shared dataset that both the
 * Dashboard (first 6 rows) and Admin Access render today, so the limit must
 * stay at 20.
 */
export async function fetchAuditLog(): Promise<readonly AuditEntryRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase
    .from("admin_audit_log")
    .select("*")
    .order("created_at", {ascending: false})
    .limit(20)
  if (error) throw error
  return data ?? []
}

/**
 * Upsert one admin role, keyed by `profile_id`. The Supabase error message is
 * preserved verbatim so the caller can surface it to the operator.
 *
 * Callers must apply `emptyToNull` to `note` before calling — the
 * empty-string→null conversion is deliberately the caller's responsibility.
 */
export async function upsertAdminRole(args: UpsertAdminRoleArgs): Promise<void> {
  const {error} = await adminSupabase
    .from("admin_roles")
    .upsert(args)
  if (error) throw new Error(error.message)
}

/**
 * Upsert one allowlist entry, keyed by `email`. The caller is responsible for
 * normalizing the email and validating the `@` before calling here. Callers
 * must also apply `emptyToNull` to `note` before calling — the empty-string→
 * null conversion is deliberately the caller's responsibility.
 */
export async function upsertAdminEmailRole(args: UpsertAdminEmailRoleArgs): Promise<void> {
  const {error} = await adminSupabase
    .from("admin_email_allowlist")
    .upsert(args, {onConflict: "email"})
  if (error) throw new Error(error.message)
}

/**
 * Delete one allowlist entry by email. The "cannot delete your own email"
 * guard is a UI-level rule and is not enforced here.
 */
export async function deleteAdminEmailRole(email: string): Promise<void> {
  const {error} = await adminSupabase
    .from("admin_email_allowlist")
    .delete()
    .eq("email", email)
  if (error) throw new Error(error.message)
}
