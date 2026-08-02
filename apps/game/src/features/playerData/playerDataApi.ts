import type { User } from '@supabase/supabase-js';
import { baseApi, toApiError } from '../../store/baseApi';
import {
  completeOAuthProfile,
  fetchActiveXpBoost,
  fetchLevelConfigs,
  fetchLevelStatusTiers,
  fetchProfile,
  fetchWallet,
  type ActiveXpBoost,
  type LevelConfig,
  type LevelStatusTier,
  type ProfileRow,
  type UserWallet,
} from '../../lib/playerData';

/** Minimal slice of store state read by the OAuth stale-result guard. */
interface AuthGuardState {
  auth: { userId: string | null };
}

export const playerDataApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getProfile: build.query<ProfileRow | null, string>({
      queryFn: async (userId) => {
        try {
          return { data: await fetchProfile(userId) };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: (_result, _error, userId) => [{ type: 'Profile', id: userId }],
    }),
    getWallet: build.query<UserWallet | null, string>({
      queryFn: async (userId) => {
        try {
          return { data: await fetchWallet(userId) };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: (_result, _error, userId) => [{ type: 'Wallet', id: userId }],
    }),
    getLevelConfigs: build.query<LevelConfig[], void>({
      queryFn: async () => {
        try {
          return { data: await fetchLevelConfigs() };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: [{ type: 'LevelConfigs' }],
    }),
    getLevelStatusTiers: build.query<LevelStatusTier[], void>({
      queryFn: async () => {
        try {
          return { data: await fetchLevelStatusTiers() };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: [{ type: 'LevelStatusTiers' }],
    }),
    getActiveXpBoost: build.query<ActiveXpBoost | null, string>({
      queryFn: async (userId) => {
        try {
          return { data: await fetchActiveXpBoost(userId) };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      providesTags: (_result, _error, userId) => [{ type: 'XpBoost', id: userId }],
    }),
    completeOAuthProfile: build.mutation<ProfileRow, User>({
      queryFn: async (user) => {
        try {
          return { data: await completeOAuthProfile(user) };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      async onQueryStarted(user, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // Guard the stale-result race: if the identity changed (or auth
          // cleared) while this mutation was in flight, do not write the
          // older user's rows back into the cache.
          if ((getState() as unknown as AuthGuardState).auth.userId !== user.id) return;
          // Upsert (not update) so a fresh sign-in also creates the
          // profile cache entry when no getProfile query ran yet. The
          // repo User argument lives only in the mutation arg — it is
          // never copied into a slice or cache row, so no session or
          // token survives past the mutation entry.
          await dispatch(playerDataApi.util.upsertQueryData('getProfile', user.id, data));
          if ((getState() as unknown as AuthGuardState).auth.userId !== user.id) return;
          // The wallet query may have settled before provisioning
          // finished, so re-run it once (non-subscribing) to match the
          // legacy post-sign-in wallet fetch.
          await dispatch(
            playerDataApi.endpoints.getWallet.initiate(user.id, {
              subscribe: false,
              forceRefetch: true,
            }),
          );
        } catch {
          // A failed mutation leaves any existing profile cache alone.
        }
      },
    }),
  }),
});

export const {
  useGetProfileQuery,
  useGetWalletQuery,
  useGetLevelConfigsQuery,
  useGetLevelStatusTiersQuery,
  useGetActiveXpBoostQuery,
  useCompleteOAuthProfileMutation,
} = playerDataApi;
