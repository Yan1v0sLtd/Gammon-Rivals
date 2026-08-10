import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchAdminRoles,
  fetchAdminEmailRoles,
  fetchAuditLog,
  upsertAdminRole,
  upsertAdminEmailRole,
  deleteAdminEmailRole,
  type AdminRoleRow,
  type AdminEmailRoleRow,
  type AuditEntryRow,
  type UpsertAdminRoleArgs,
  type UpsertAdminEmailRoleArgs,
} from "./AdminAccessData"

/**
 * One shared `AdminAccess` tag on purpose: today every Admin Access write
 * calls `loadAdminData()` and refetches roles, allowlist, and audit together,
 * and the database triggers mean a role/allowlist write also produces a new
 * audit row. Per-table tags would silently stop refreshing the audit feed.
 */
export const adminAccessApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
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
  useGetAdminRolesQuery,
  useGetAdminEmailRolesQuery,
  useGetAuditLogQuery,
  useUpsertAdminRoleMutation,
  useUpsertAdminEmailRoleMutation,
  useDeleteAdminEmailRoleMutation,
} = adminAccessApi
