import {adminBaseApi, toAdminApiError} from "../../store/baseApi"

import {
  deleteShopItem,
  fetchShopItems,
  fetchStoreConfig,
  fetchStoreSale,
  upsertShopItem,
  upsertStoreConfig,
  upsertStoreSale,
  type SaleRow,
  type ShopItem,
  type StoreConfigRow,
  type UpsertShopItemPayload,
  type UpsertStoreConfigPayload,
  type UpsertStoreSaleArgs,
} from "./ShopData"

/**
 * The Shop section owns three data domains — shop_items, store_sales
 * (the global Store Sale), store_config (storefront appearance) — each
 * with its own tag, mirroring the old per-domain loadAdminData() legs:
 * a write refetches only the domain it changed. The sale/config reads
 * used to fail silently (the legacy loader only threw on shop_items), so
 * the feature reports only the getShopItems error through onError.
 */
export const shopApi = adminBaseApi.injectEndpoints({
  endpoints: (build) => ({
    getShopItems: build.query<ShopItem[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchShopItems()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["Shop"],
    }),
    getStoreSale: build.query<SaleRow | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchStoreSale()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["StoreSales"],
    }),
    getStoreConfig: build.query<StoreConfigRow | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchStoreConfig()}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      providesTags: ["StoreConfig"],
    }),
    updateShopItem: build.mutation<void, UpsertShopItemPayload>({
      queryFn: async (payload) => {
        try {
          await upsertShopItem(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Shop"],
    }),
    deleteShopItem: build.mutation<void, string>({
      queryFn: async (id) => {
        try {
          await deleteShopItem(id)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["Shop"],
    }),
    upsertStoreSale: build.mutation<void, UpsertStoreSaleArgs>({
      queryFn: async (args) => {
        try {
          await upsertStoreSale(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["StoreSales"],
    }),
    upsertStoreConfig: build.mutation<void, UpsertStoreConfigPayload>({
      queryFn: async (payload) => {
        try {
          await upsertStoreConfig(payload)
          return {data: undefined}
        }
        catch (err) {
          return {error: toAdminApiError(err)}
        }
      },
      invalidatesTags: ["StoreConfig"],
    }),
  }),
})

export const {
  useGetShopItemsQuery,
  useGetStoreSaleQuery,
  useGetStoreConfigQuery,
  useUpdateShopItemMutation,
  useDeleteShopItemMutation,
  useUpsertStoreSaleMutation,
  useUpsertStoreConfigMutation,
} = shopApi
