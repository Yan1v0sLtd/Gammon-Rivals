import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {type DashboardStats, fetchDashboardStats} from "./DashboardData"

export const dashboardApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getDashboardStats: build.query<DashboardStats, void>({
      queryFn: async () => {
        try {
          return {data: await fetchDashboardStats()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Dashboard"],
    }),
  }),
})

export const {useGetDashboardStatsQuery} = dashboardApi
