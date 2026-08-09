import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchEconomyGrants,
  upsertEconomyGrant,
  type EconomyGrantRow,
  type UpsertEconomyGrantArgs,
} from "./EconomyGrantsData"

export const economyGrantsApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getEconomyGrants: build.query<readonly EconomyGrantRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchEconomyGrants()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["EconomyGrants"],
    }),
    upsertEconomyGrant: build.mutation<void, UpsertEconomyGrantArgs>({
      queryFn: async (args) => {
        try {
          await upsertEconomyGrant(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["EconomyGrants"],
    }),
  }),
})

export const {
  useGetEconomyGrantsQuery,
  useUpsertEconomyGrantMutation,
} = economyGrantsApi
