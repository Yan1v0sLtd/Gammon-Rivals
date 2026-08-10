import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  type AdminAccessCheck,
  type AdminEmailRoleRow,
  type AdminRoleRow,
  type AuditEntryRow,
  deleteAdminEmailRole,
  fetchAdminEmailRoles,
  fetchAdminRoles,
  fetchAuditLog,
  fetchMyAdminAccess,
  upsertAdminEmailRole,
  type UpsertAdminEmailRoleArgs,
  upsertAdminRole,
  type UpsertAdminRoleArgs,
} from "./AdminAccessData"

/**
 * One shared `AdminAccess` tag on purpose: today every Admin Access write
 * calls `loadAdminData()` and refetches roles, allowlist, and audit together,
 * and the database triggers mean a role/allowlist write also produces a new
 * audit row. Per-table tags would silently stop refreshing the audit feed.
 */
export const adminAccessApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * Gates the whole Back Office (see AdminAuthGate). The argument is the
     * operator's user id: the check itself reads the session server-side, so
     * the id only shapes the cache key — one entry per operator means a token
     * refresh re-renders from cache (no "Checking access" flash) while signing
     * in as somebody else fetches fresh.
     *
     * Deliberately untagged: the global Refresh button and the Admin Access
     * writes invalidate `AdminAccess`, and re-running the gate on those would
     * risk unmounting the shell mid-edit.
     */
    getMyAdminAccess: build.query<AdminAccessCheck, string>({
      queryFn: async () => {
        try {
          return {data: await fetchMyAdminAccess()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
    }),
    getAdminRoles: build.query<readonly AdminRoleRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchAdminRoles()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["AdminAccess"],
    }),
    getAdminEmailRoles: build.query<readonly AdminEmailRoleRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchAdminEmailRoles()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["AdminAccess"],
    }),
    getAuditLog: build.query<readonly AuditEntryRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchAuditLog()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["AdminAccess"],
    }),
    upsertAdminRole: build.mutation<void, UpsertAdminRoleArgs>({
      queryFn: async (args) => {
        try {
          await upsertAdminRole(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["AdminAccess"],
    }),
    upsertAdminEmailRole: build.mutation<void, UpsertAdminEmailRoleArgs>({
      queryFn: async (args) => {
        try {
          await upsertAdminEmailRole(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["AdminAccess"],
    }),
    deleteAdminEmailRole: build.mutation<void, string>({
      queryFn: async (email) => {
        try {
          await deleteAdminEmailRole(email)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["AdminAccess"],
    }),
  }),
})

export const {
  useGetMyAdminAccessQuery,
  useGetAdminRolesQuery,
  useGetAdminEmailRolesQuery,
  useGetAuditLogQuery,
  useUpsertAdminRoleMutation,
  useUpsertAdminEmailRoleMutation,
  useDeleteAdminEmailRoleMutation,
} = adminAccessApi
