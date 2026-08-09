import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchDailyBonusConfigs,
  upsertDailyBonusConfig,
  type DailyBonusConfigRow,
  type UpsertDailyBonusConfigArgs,
} from "./DailyBonusData"

export const dailyBonusApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getDailyBonus: build.query<readonly DailyBonusConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchDailyBonusConfigs()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["DailyBonus"],
    }),
    upsertDailyBonus: build.mutation<void, UpsertDailyBonusConfigArgs>({
      queryFn: async (args) => {
        try {
          await upsertDailyBonusConfig(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["DailyBonus"],
    }),
  }),
})

export const {
  useGetDailyBonusQuery,
  useUpsertDailyBonusMutation,
} = dailyBonusApi
