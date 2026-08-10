import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  adjustWallet,
  fetchUserDetail,
  fetchUsers,
  hardDeleteUsers,
  softDeleteUsers,
  toggleSuspension,
  updateProfile,
  type AdminUser,
  type AdjustWalletPayload,
  type SoftDeletePayload,
  type ToggleSuspensionPayload,
  type UpdateProfilePayload,
  type UserDetail,
} from "./UsersData"

/**
 * The Users section owns one read for the directory list (with attached
 * wallets) and one per-selection read for the full inspector. All five
 * mutations share a single "Users" tag — a profile/wallet write should
 * refetch both the list row and the open inspector, exactly like the old
 * `await loadAdminData()` refresh did.
 */
export const usersApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getUsers: build.query<AdminUser[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchUsers()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Users"],
    }),
    getUserDetail: build.query<UserDetail, string>({
      queryFn: async (profileId) => {
        try {
          return {data: await fetchUserDetail(profileId)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Users"],
    }),
    updateProfile: build.mutation<void, UpdateProfilePayload>({
      queryFn: async (payload) => {
        try {
          await updateProfile(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Users"],
    }),
    toggleSuspension: build.mutation<void, ToggleSuspensionPayload>({
      queryFn: async (payload) => {
        try {
          await toggleSuspension(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Users"],
    }),
    adjustWallet: build.mutation<void, AdjustWalletPayload>({
      queryFn: async (payload) => {
        try {
          await adjustWallet(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Users"],
    }),
    softDeleteUsers: build.mutation<void, SoftDeletePayload>({
      queryFn: async (payload) => {
        try {
          await softDeleteUsers(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Users"],
    }),
    hardDeleteUsers: build.mutation<void, string[]>({
      queryFn: async (profileIds) => {
        try {
          await hardDeleteUsers(profileIds)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Users"],
    }),
  }),
})

export const {
  useGetUsersQuery,
  useGetUserDetailQuery,
  useUpdateProfileMutation,
  useToggleSuspensionMutation,
  useAdjustWalletMutation,
  useSoftDeleteUsersMutation,
  useHardDeleteUsersMutation,
} = usersApi
