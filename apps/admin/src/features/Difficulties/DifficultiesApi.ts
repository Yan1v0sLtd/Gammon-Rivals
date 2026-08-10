import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {fetchTables, type TableConfigInsert, type TableConfigRow, upsertTable} from "./DifficultiesData"

export const difficultiesApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getTables: build.query<readonly TableConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchTables()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Difficulties"],
    }),
    upsertTable: build.mutation<void, TableConfigInsert>({
      queryFn: async (payload) => {
        try {
          await upsertTable(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Difficulties"],
    }),
  }),
})

export const {
  useGetTablesQuery,
  useUpsertTableMutation,
} = difficultiesApi
