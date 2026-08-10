import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  activateLoadingScreen as activateLoadingScreenRow,
  activatePodium as activatePodiumRow,
  addLoadingScreen,
  addPodium,
  type BoardThemeConfigInsert,
  type BoardThemeConfigRow,
  deleteBoard,
  deleteLoadingScreen,
  deletePodium,
  fetchBoards,
  fetchLoadingScreens,
  fetchPodiums,
  type LoadingScreenImageInsert,
  type LoadingScreenImageRow,
  type PodiumImageInsert,
  type PodiumImageRow,
  seedBoards,
  upsertBoard,
} from "./BoardThemesData"

/**
 * Board Themes owns three data domains (boards, podiums, loading
 * screens) on one route. Each domain has its own tag so a write
 * refetches only what it changed, mirroring the old per-domain
 * `loadX(successMessage)` refresh calls.
 */
export const boardThemesApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getBoards: build.query<readonly BoardThemeConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchBoards()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["BoardThemes"],
    }),
    upsertBoard: build.mutation<void, BoardThemeConfigInsert>({
      queryFn: async (payload) => {
        try {
          await upsertBoard(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemes"],
    }),
    deleteBoard: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await deleteBoard(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemes"],
    }),
    seedBoards: build.mutation<void, readonly BoardThemeConfigInsert[]>({
      queryFn: async (payloads) => {
        try {
          await seedBoards(payloads)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemes"],
    }),
    getPodiums: build.query<readonly PodiumImageRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchPodiums()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["BoardThemesPodiums"],
    }),
    addPodium: build.mutation<void, PodiumImageInsert>({
      queryFn: async (payload) => {
        try {
          await addPodium(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesPodiums"],
    }),
    activatePodium: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await activatePodiumRow(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesPodiums"],
    }),
    deletePodium: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await deletePodium(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesPodiums"],
    }),
    getLoadingScreens: build.query<readonly LoadingScreenImageRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLoadingScreens()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["BoardThemesLoadingScreens"],
    }),
    addLoadingScreen: build.mutation<void, LoadingScreenImageInsert>({
      queryFn: async (payload) => {
        try {
          await addLoadingScreen(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesLoadingScreens"],
    }),
    activateLoadingScreen: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await activateLoadingScreenRow(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesLoadingScreens"],
    }),
    deleteLoadingScreen: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await deleteLoadingScreen(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["BoardThemesLoadingScreens"],
    }),
  }),
})

export const {
  useGetBoardsQuery,
  useUpsertBoardMutation,
  useDeleteBoardMutation,
  useSeedBoardsMutation,
  useGetPodiumsQuery,
  useAddPodiumMutation,
  useActivatePodiumMutation,
  useDeletePodiumMutation,
  useGetLoadingScreensQuery,
  useAddLoadingScreenMutation,
  useActivateLoadingScreenMutation,
  useDeleteLoadingScreenMutation,
} = boardThemesApi
