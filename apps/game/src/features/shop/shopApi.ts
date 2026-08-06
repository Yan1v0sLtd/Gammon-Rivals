import {baseApi, toApiError} from "../../store/baseApi"

import {
  fetchShopCatalog,
  fetchStoreConfig,
  fetchStoreSale,
  purchaseShopItem,
  type ShopItemRow,
  type ShopSale,
  type ShopStoreConfig,
} from "./shopData"

/**
 * Storefront queries. No `keepUnusedDataFor` override and no tags: the
 * boot-time warm-up (see shopListeners) holds an app-lifetime subscription so
 * these entries stay resident for the session instead of expiring on a timer,
 * and the Shop refetches all three on open so a resident entry can't go stale.
 * Nothing on the client mutates the catalog, so there is no tag to invalidate.
 */
export const shopApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getShopCatalog: build.query<readonly ShopItemRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchShopCatalog()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
    getStoreSale: build.query<ShopSale | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchStoreSale()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
    getStoreConfig: build.query<ShopStoreConfig | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchStoreConfig()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
    purchaseShopItem: build.mutation<void, {itemId: string, userId: string}>({
      queryFn: async ({itemId}) => {
        try {
          await purchaseShopItem(itemId)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // No invalidatesTags: the post-purchase player-data refresh (wallet +
      // XP boost) is a delayed workflow owned by the shopGrantConfirmed
      // listener in features/shop/shopListeners.ts, so the reward-flight
      // animation lands before the balance ticks up.
    }),
  }),
})

export const {
  useGetShopCatalogQuery,
  useGetStoreSaleQuery,
  useGetStoreConfigQuery,
  usePurchaseShopItemMutation,
} = shopApi
