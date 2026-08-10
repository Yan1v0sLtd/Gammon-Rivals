import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchRtpPerPlayer, fetchRtpSummary, type RtpPerPlayerArgs, type RtpPerPlayerRow, type RtpRangeId, type RtpRow,
} from "./RTPAnalyticsData"

export const rtpAnalyticsApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getRtpSummary: build.query<readonly RtpRow[], RtpRangeId>({
      queryFn: async (range) => {
        try {
          return {data: await fetchRtpSummary(range)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
    }),
    getRtpPerPlayer: build.query<readonly RtpPerPlayerRow[], RtpPerPlayerArgs>({
      queryFn: async (args) => {
        try {
          return {data: await fetchRtpPerPlayer(args)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
    }),
  }),
})

export const {
  useGetRtpSummaryQuery,
  useGetRtpPerPlayerQuery,
} = rtpAnalyticsApi
