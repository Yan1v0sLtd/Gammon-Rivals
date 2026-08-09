import {configureStore} from "@reduxjs/toolkit"

import {adminBaseApi} from "./baseApi"

export function createAdminStore() {
  return configureStore({
    reducer: {
      [adminBaseApi.reducerPath]: adminBaseApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(adminBaseApi.middleware),
    devTools: import.meta.env.DEV,
  })
}

export const store = createAdminStore()

export type AdminStore = ReturnType<typeof createAdminStore>
export type AdminRootState = ReturnType<AdminStore["getState"]>
export type AdminDispatch = AdminStore["dispatch"]
