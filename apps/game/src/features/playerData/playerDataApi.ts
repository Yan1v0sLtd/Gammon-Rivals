import {baseApi, toApiError} from '../../store/baseApi';
import {
  type ActiveXpBoost,
  fetchActiveXpBoost,
  fetchLevelConfigs,
  fetchLevelStatusTiers,
  fetchProfile,
  fetchWallet,
  type LevelConfig,
  type LevelStatusTier,
  type ProfileRow,
  updateDisplayName,
  type UserWallet,
} from './playerData';
import {
  type GameRow, getOwnerStats, listGamesForMatch, listMatchesForOwner, type MatchSummary, type OwnerStats,
} from './matchHistoryData';

/** Minimal slice of store state read by the OAuth stale-result guard. */
interface AuthGuardState {
  auth: { userId: string | null };
}

export const playerDataApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getProfile: build.query<ProfileRow | null, string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchProfile(userId)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: 'Profile',
        id: userId
      }],
    }),
    getWallet: build.query<UserWallet | null, string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchWallet(userId)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: 'Wallet',
        id: userId
      }],
    }),
    getLevelConfigs: build.query<LevelConfig[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLevelConfigs()};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: [{type: 'LevelConfigs'}],
    }),
    getLevelStatusTiers: build.query<LevelStatusTier[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLevelStatusTiers()};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: [{type: 'LevelStatusTiers'}],
    }),
    getActiveXpBoost: build.query<ActiveXpBoost | null, string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchActiveXpBoost(userId)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: 'XpBoost',
        id: userId
      }],
    }),
    getOwnerStats: build.query<OwnerStats, string>({
      queryFn: async (userId) => {
        try {
          return {data: await getOwnerStats(userId)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: 'OwnerStats',
        id: userId
      }],
    }),
    getMatchHistory: build.query<MatchSummary[], string>({
      queryFn: async (userId) => {
        try {
          return {data: await listMatchesForOwner(userId, 50)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: 'MatchHistory',
        id: userId
      }],
    }),
    getGamesForMatch: build.query<GameRow[], string>({
      queryFn: async (matchId) => {
        try {
          return {data: await listGamesForMatch(matchId)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      providesTags: (_result, _error, matchId) => [{
        type: 'GamesForMatch',
        id: matchId
      }],
    }),
    updateDisplayName: build.mutation<ProfileRow, { userId: string; name: string }>({
      queryFn: async ({
        userId,
        name
      }) => {
        try {
          return {data: await updateDisplayName(userId, name)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      async onQueryStarted(arg, {
        dispatch,
        getState,
        queryFulfilled
      }) {
        try {
          const {data} = await queryFulfilled;
          // Guard the stale-result race: if the identity changed (or auth
          // cleared) while this mutation was in flight, do not write the
          // older user's rows back into the cache.
          if ((getState() as unknown as AuthGuardState).auth.userId !== arg.userId) return;
          // Upsert (not update) so the renamed row replaces whatever the
          // getProfile query currently holds for this user.
          await dispatch(playerDataApi.util.upsertQueryData('getProfile', arg.userId, data));
          if ((getState() as unknown as AuthGuardState).auth.userId !== arg.userId) return;
        }
        catch {
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
  useGetOwnerStatsQuery,
  useGetMatchHistoryQuery,
  useLazyGetGamesForMatchQuery,
  useUpdateDisplayNameMutation,
} = playerDataApi;
