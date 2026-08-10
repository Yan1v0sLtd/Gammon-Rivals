import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchWheelConfig,
  fetchWheelSlots,
  upsertWheelConfig,
  type UpsertWheelConfigArgs,
  upsertWheelSlot,
  type UpsertWheelSlotArgs,
  type WheelConfigRow,
  type WheelSlotRow,
} from "./HourlyWheelData"

export const hourlyWheelApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getWheelConfig: build.query<WheelConfigRow | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchWheelConfig()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["HourlyWheel"],
    }),
    getWheelSlots: build.query<readonly WheelSlotRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchWheelSlots()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["HourlyWheel"],
    }),
    upsertWheelConfig: build.mutation<void, UpsertWheelConfigArgs>({
      queryFn: async (args) => {
        try {
          await upsertWheelConfig(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["HourlyWheel"],
    }),
    upsertWheelSlot: build.mutation<void, UpsertWheelSlotArgs>({
      queryFn: async (args) => {
        try {
          await upsertWheelSlot(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["HourlyWheel"],
    }),
  }),
})

export const {
  useGetWheelConfigQuery,
  useGetWheelSlotsQuery,
  useUpsertWheelConfigMutation,
  useUpsertWheelSlotMutation,
} = hourlyWheelApi
