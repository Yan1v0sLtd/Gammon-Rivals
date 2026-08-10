import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  applyLevelCurve,
  deleteLevelConfigsAboveCap,
  deleteLevelStatusTiers,
  fetchLevelConfigs,
  fetchLevelStatusTiers,
  insertLevelStatusTiers,
  type LevelConfigInsert,
  type LevelConfigRow,
  type LevelStatusTierInsert,
  type LevelStatusTierRow,
  type LevelStatusTierUpdate,
  recomputePlayerLevels,
  updateLevelStatusTier,
  upsertLevelConfig,
} from "./LevelSystemData"

export const levelSystemApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getLevelConfigs: build.query<readonly LevelConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLevelConfigs()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["LevelSystem"],
    }),
    getLevelStatusTiers: build.query<readonly LevelStatusTierRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLevelStatusTiers()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["LevelSystem"],
    }),
    upsertLevel: build.mutation<void, LevelConfigInsert>({
      queryFn: async (payload) => {
        try {
          await upsertLevelConfig(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    deleteLevelStatusTiers: build.mutation<void, readonly string[]>({
      queryFn: async (ids) => {
        try {
          await deleteLevelStatusTiers(ids)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    insertLevelStatusTiers: build.mutation<void, readonly LevelStatusTierInsert[]>({
      queryFn: async (rows) => {
        try {
          await insertLevelStatusTiers(rows)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    updateLevelStatusTier: build.mutation<void, {
      id: string,
      patch: LevelStatusTierUpdate,
    }>({
      queryFn: async ({
        id,
        patch,
      }) => {
        try {
          await updateLevelStatusTier(id, patch)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    deleteLevelConfigsAboveCap: build.mutation<void, number>({
      queryFn: async (maxLevel) => {
        try {
          await deleteLevelConfigsAboveCap(maxLevel)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    recomputePlayerLevels: build.mutation<number, void>({
      queryFn: async () => {
        try {
          return {data: await recomputePlayerLevels()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
    applyLevelCurve: build.mutation<number, {
      rows: readonly LevelConfigInsert[],
      maxLevel: number,
    }>({
      queryFn: async (args) => {
        try {
          return {data: await applyLevelCurve(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LevelSystem"],
    }),
  }),
})

export const {
  useGetLevelConfigsQuery,
  useGetLevelStatusTiersQuery,
  useUpsertLevelMutation,
  useDeleteLevelStatusTiersMutation,
  useInsertLevelStatusTiersMutation,
  useUpdateLevelStatusTierMutation,
  useDeleteLevelConfigsAboveCapMutation,
  useRecomputePlayerLevelsMutation,
  useApplyLevelCurveMutation,
} = levelSystemApi
