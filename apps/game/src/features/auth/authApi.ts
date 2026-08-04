import {baseApi, toApiError} from "../../store/baseApi"

import {deleteMyAccount} from "./authData"

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    deleteMyAccount: build.mutation<void, void>({
      queryFn: async () => {
        try {
          await deleteMyAccount()
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
  }),
})

export const {useDeleteMyAccountMutation} = authApi
