import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  assignSimDailyMissions,
  type ChestMilestoneRow,
  type ChestMilestoneUpdate,
  type ChestRewardInsert,
  type ChestRewardRow,
  cleanupSimAll,
  createSimTestProfile,
  deleteMissionTemplate,
  fetchChestMilestones,
  fetchChestRewards,
  fetchMissionRewards,
  fetchMissionTemplates,
  fetchMissionTypeConfigs,
  fetchRerollPricingConfig,
  fetchStreakChestRewards,
  getSimTestUserState,
  listSimTestProfiles,
  type MissionRewardDraft,
  type MissionRewardRow,
  type MissionTemplateInsert,
  type MissionTemplateRow,
  type MissionTypeConfigRow,
  type MissionTypeConfigUpdate,
  refreshPlayerMissions,
  type RefreshPlayerMissionsResult,
  type RerollPricingConfigRow,
  type RerollPricingConfigUpdate,
  resetSimTodayMissions,
  saveChestMilestone,
  saveMissionTemplate,
  saveStreakChestRewards,
  setSimMetric,
  type SimSpawnResult,
  type SimTestProfileSummary,
  type SimTestUserState,
  spawnSimArchetypes,
  type StreakChestRewardInsert,
  type StreakChestRewardRow,
  updateMissionTypeConfig,
  updateRerollPricingConfig,
} from "./DailyMissionsData"

export const dailyMissionsApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getMissionTypeConfigs: build.query<readonly MissionTypeConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchMissionTypeConfigs()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getMissionTemplates: build.query<readonly MissionTemplateRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchMissionTemplates()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getMissionRewards: build.query<readonly MissionRewardRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchMissionRewards()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getChestMilestones: build.query<readonly ChestMilestoneRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchChestMilestones()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getChestRewards: build.query<readonly ChestRewardRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchChestRewards()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getRerollPricingConfig: build.query<RerollPricingConfigRow | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchRerollPricingConfig()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getStreakChestRewards: build.query<readonly StreakChestRewardRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchStreakChestRewards()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getSimTestProfiles: build.query<readonly SimTestProfileSummary[], void>({
      queryFn: async () => {
        try {
          return {data: await listSimTestProfiles()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),
    getSimTestUserState: build.query<SimTestUserState, string>({
      queryFn: async (profileId) => {
        try {
          return {data: await getSimTestUserState(profileId)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyMissions"],
    }),

    saveMissionTemplate: build.mutation<string, {
      id: string | null,
      payload: MissionTemplateInsert,
      rewards: readonly MissionRewardDraft[],
    }>({
      queryFn: async (args) => {
        try {
          return {data: await saveMissionTemplate(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    deleteMissionTemplate: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await deleteMissionTemplate(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    updateMissionTypeConfig: build.mutation<void, {
      missionType: string,
      patch: MissionTypeConfigUpdate,
    }>({
      queryFn: async (args) => {
        try {
          await updateMissionTypeConfig(args.missionType, args.patch)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    saveChestMilestone: build.mutation<void, {
      id: string,
      patch: ChestMilestoneUpdate,
      rewards: readonly ChestRewardInsert[],
    }>({
      queryFn: async (args) => {
        try {
          await saveChestMilestone(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    updateRerollPricingConfig: build.mutation<void, RerollPricingConfigUpdate>({
      queryFn: async (patch) => {
        try {
          await updateRerollPricingConfig(patch)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    saveStreakChestRewards: build.mutation<void, readonly StreakChestRewardInsert[]>({
      queryFn: async (rows) => {
        try {
          await saveStreakChestRewards(rows)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    refreshPlayerMissions: build.mutation<RefreshPlayerMissionsResult, string>({
      queryFn: async (email) => {
        try {
          return {data: await refreshPlayerMissions(email)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    createSimTestProfile: build.mutation<string, {
      displayName: string,
      level: number,
      pvpRating: number,
    }>({
      queryFn: async (args) => {
        try {
          return {data: await createSimTestProfile(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    setSimMetric: build.mutation<string, {
      profileId: string,
      metricCode: string,
      baseline: number,
    }>({
      queryFn: async (args) => {
        try {
          return {data: await setSimMetric(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    resetSimTodayMissions: build.mutation<number, string>({
      queryFn: async (profileId) => {
        try {
          return {data: await resetSimTodayMissions(profileId)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    assignSimDailyMissions: build.mutation<number, string>({
      queryFn: async (profileId) => {
        try {
          return {data: await assignSimDailyMissions(profileId)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    spawnSimArchetypes: build.mutation<SimSpawnResult, {
      casuals: number,
      regulars: number,
      whales: number,
    }>({
      queryFn: async (args) => {
        try {
          return {data: await spawnSimArchetypes(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
    cleanupSimAll: build.mutation<number, void>({
      queryFn: async () => {
        try {
          return {data: await cleanupSimAll()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyMissions"],
    }),
  }),
})

export const {
  useGetMissionTypeConfigsQuery,
  useGetMissionTemplatesQuery,
  useGetMissionRewardsQuery,
  useGetChestMilestonesQuery,
  useGetChestRewardsQuery,
  useGetRerollPricingConfigQuery,
  useGetStreakChestRewardsQuery,
  useGetSimTestProfilesQuery,
  useGetSimTestUserStateQuery,
  useSaveMissionTemplateMutation,
  useDeleteMissionTemplateMutation,
  useUpdateMissionTypeConfigMutation,
  useSaveChestMilestoneMutation,
  useUpdateRerollPricingConfigMutation,
  useSaveStreakChestRewardsMutation,
  useRefreshPlayerMissionsMutation,
  useCreateSimTestProfileMutation,
  useSetSimMetricMutation,
  useResetSimTodayMissionsMutation,
  useAssignSimDailyMissionsMutation,
  useSpawnSimArchetypesMutation,
  useCleanupSimAllMutation,
} = dailyMissionsApi
