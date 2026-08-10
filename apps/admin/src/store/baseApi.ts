import {createApi, fakeBaseQuery} from "@reduxjs/toolkit/query/react"

export type AdminApiError = {
  message: string,
  /** PostgREST error code, preserved when present (e.g. "42501" policy violations). */
  code?: string,
}

/** Normalize any queryFn rejection into the shared serializable AdminApiError shape. */
export function toAdminApiError(err: unknown): AdminApiError {
  if (err instanceof Error) return {message: err.message}
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    const code = (err as {code?: unknown}).code
    return {
      message: err.message,
      code: typeof code === "string" ? code : undefined,
    }
  }
  return {message: String(err)}
}

export const adminBaseApi = createApi({
  reducerPath: "adminApi",
  baseQuery: fakeBaseQuery<AdminApiError>(),
  tagTypes: ["Currencies", "LobbyFeatures", "EconomyGrants", "DailyBonus", "HourlyWheel", "LevelSystem", "DailyMissions", "Difficulties", "BoardThemes", "BoardThemesPodiums", "BoardThemesLoadingScreens", "Dashboard", "Users", "AdminAccess"],
  endpoints: () => ({}),
})
