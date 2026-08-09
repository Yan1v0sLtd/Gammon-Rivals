import {createApi, fakeBaseQuery} from "@reduxjs/toolkit/query/react"

export type AdminApiError = {
  message: string,
}

/** Normalize any queryFn rejection into the shared serializable AdminApiError shape. */
export function toAdminApiError(err: unknown): AdminApiError {
  if (err instanceof Error) return {message: err.message}
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    return {message: err.message}
  }
  return {message: String(err)}
}

export const adminBaseApi = createApi({
  reducerPath: "adminApi",
  baseQuery: fakeBaseQuery<AdminApiError>(),
  tagTypes: ["Currencies", "LobbyFeatures", "EconomyGrants", "DailyBonus", "HourlyWheel", "LevelSystem", "DailyMissions"],
  endpoints: () => ({}),
})
