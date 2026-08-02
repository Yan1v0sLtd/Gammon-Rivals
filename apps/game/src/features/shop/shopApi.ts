import { baseApi, toApiError } from '../../store/baseApi';
import {
  fetchShopCatalog,
  fetchStoreConfig,
  fetchStoreSale,
  purchaseShopItem,
  type ShopItemRow,
  type ShopSale,
  type ShopStoreConfig,
} from '../../lib/shopData';

export const shopApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getShopCatalog: build.query<readonly ShopItemRow[], void>({
      queryFn: async () => {
        try {
          return { data: await fetchShopCatalog() };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      // 30 minutes: the boot-time prefetch (see ShopHost) stays warm until
      // the player opens the Store minutes later — this replaces the old
      // permanent module-level shop cache. No tag invalidation: nothing on
      // the client mutates the catalog, so these entries are refreshed by
      // refetch()/cache expiry instead.
      keepUnusedDataFor: 1800,
    }),
    getStoreSale: build.query<ShopSale | null, void>({
      queryFn: async () => {
        try {
          return { data: await fetchStoreSale() };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      keepUnusedDataFor: 1800,
    }),
    getStoreConfig: build.query<ShopStoreConfig | null, void>({
      queryFn: async () => {
        try {
          return { data: await fetchStoreConfig() };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      keepUnusedDataFor: 1800,
    }),
    purchaseShopItem: build.mutation<void, { itemId: string; userId: string }>({
      queryFn: async ({ itemId }) => {
        try {
          await purchaseShopItem(itemId);
          return { data: undefined };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      // No invalidatesTags: the post-purchase player-data refresh (wallet +
      // XP boost) is a delayed workflow owned by the shopGrantConfirmed
      // listener in store/listenerMiddleware.ts, so the reward-flight
      // animation lands before the balance ticks up.
    }),
  }),
});

export const {
  useGetShopCatalogQuery,
  useGetStoreSaleQuery,
  useGetStoreConfigQuery,
  usePurchaseShopItemMutation,
} = shopApi;
