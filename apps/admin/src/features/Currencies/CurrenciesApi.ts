import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  type CurrencyConfigRow, fetchCurrencies, upsertCurrencyConfig, type UpsertCurrencyConfigArgs,
} from "./CurrenciesData"

export const currenciesApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getCurrencies: build.query<readonly CurrencyConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchCurrencies()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Currencies"],
    }),
    upsertCurrency: build.mutation<void, UpsertCurrencyConfigArgs>({
      queryFn: async (args) => {
        try {
          await upsertCurrencyConfig(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Currencies"],
    }),
  }),
})

export const {
  useGetCurrenciesQuery,
  useUpsertCurrencyMutation,
} = currenciesApi
