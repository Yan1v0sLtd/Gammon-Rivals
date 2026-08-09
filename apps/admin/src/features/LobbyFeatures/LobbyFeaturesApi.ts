import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  fetchLobbyFeatures,
  updateLobbyFeature,
  type LobbyFeatureConfig,
  type LobbyFeatureConfigRow,
} from "./LobbyFeaturesData"

export const lobbyFeaturesApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getLobbyFeatures: build.query<readonly LobbyFeatureConfig[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLobbyFeatures()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["LobbyFeatures"],
    }),
    updateLobbyFeature: build.mutation<
      LobbyFeatureConfig,
      {featureKey: string, patch: Pick<LobbyFeatureConfigRow, "unlock_level" | "is_enabled" | "tooltip_text">}
    >({
      queryFn: async ({featureKey, patch}) => {
        try {
          return {data: await updateLobbyFeature(featureKey, patch)}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["LobbyFeatures"],
    }),
  }),
})

export const {
  useGetLobbyFeaturesQuery,
  useUpdateLobbyFeatureMutation,
} = lobbyFeaturesApi
