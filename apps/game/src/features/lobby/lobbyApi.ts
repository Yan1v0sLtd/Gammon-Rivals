import {isSupabaseConfigured, supabase} from "../../lib/supabase"
import {baseApi, toApiError} from "../../store/baseApi"

import {dailyBonusClaimConfirmed} from "./lobbyActions"
import {
  type BoardThemeConfigRow,
  claimDailyBonus,
  type ClaimDailyBonusResult,
  claimMission,
  type ClaimMissionResult,
  claimStreakChest,
  type DailyBonusConfigRow,
  fetchActivePodium,
  fetchDailyBonusConfigs,
  fetchDailyBonusState,
  fetchDailyMissions,
  fetchLobbyBoards,
  fetchLobbyFeatureConfigs,
  fetchTableConfigs,
  fetchUserBoardInventory,
  fetchWheelState,
  type LobbyFeatureConfigMap,
  markTutorialComplete,
  type MissionsState,
  purchaseBoardWithGems,
  rerollMission,
  spinWheel,
  type TableConfigRow,
  type UserDailyBonusRow,
  type WheelSpinResult,
  type WheelState,
} from "./lobbyData"
import {abandonStaleMatches} from "./matchmakingData"

// Direct supabase access is the cache-lifetime Realtime exception; all
// ordinary request/response I/O stays delegated to features/lobby/lobbyData.

export const lobbyApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getLobbyBoards: build.query<readonly BoardThemeConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchLobbyBoards()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: [{type: "LobbyBoards"}],
      keepUnusedDataFor: 1800,
    }),
    getUserBoardInventory: build.query<readonly string[], string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchUserBoardInventory(userId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: "BoardInventory",
        id: userId,
      }],
    }),
    getLobbyFeatureConfigs: build.query<LobbyFeatureConfigMap, void>({
      queryFn: async () => {
        try {
          return {data: await fetchLobbyFeatureConfigs()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: [{type: "LobbyFeatureConfigs"}],
      keepUnusedDataFor: 1800,
    }),
    getDailyBonusConfigs: build.query<readonly DailyBonusConfigRow[], void>({
      queryFn: async () => {
        try {
          return {data: await fetchDailyBonusConfigs()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: [{type: "DailyBonusConfigs"}],
      keepUnusedDataFor: 1800,
    }),
    getDailyBonusState: build.query<UserDailyBonusRow | null, string>({
      queryFn: async (userId) => {
        try {
          return {data: await fetchDailyBonusState(userId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: "DailyBonusState",
        id: userId,
      }],
    }),
    getWheelState: build.query<WheelState | null, string>({
      queryFn: async (configId) => {
        try {
          return {data: await fetchWheelState(configId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, configId) => [{
        type: "WheelState",
        id: configId,
      }], // Owns the cooldown zero-crossing re-fetch for the cache entry's whole
      // life: invalidate once the server-reported next_spin_at passes, then
      // re-arm from the refetched cache. `can_spin_now` only ever changes via
      // that refetch — never from the client clock. The 1.5s floor keeps a
      // pathological stale server timestamp from re-fetching in a tight loop.
      async onCacheEntryAdded(configId, {
        cacheDataLoaded,
        cacheEntryRemoved,
        dispatch,
        getCacheEntry,
      }) {
        try {
          await cacheDataLoaded
          for (; ;) {
            const state = getCacheEntry().data
            if (!state || !state.is_enabled || state.can_spin_now) return
            const untilZero = new Date(state.next_spin_at).getTime() - Date.now()
            const delayMs = Math.min(Math.max(untilZero + 250, 1500), 2 ** 31 - 1)

            let timerId: ReturnType<typeof window.setTimeout> = 0
            const ticked = new Promise<"tick">((resolve) => {
              timerId = window.setTimeout(() => {
                resolve("tick")
              }, delayMs)
            })
            // Whichever wins, the timeout is cleared if the cache entry dies
            // first, so no orphan timer outlives the cache entry.
            if ((await Promise.race([ticked, cacheEntryRemoved])) !== "tick") {
              window.clearTimeout(timerId)
              return
            }
            dispatch(lobbyApi.util.invalidateTags([{
              type: "WheelState",
              id: configId,
            }]))
          }
        }
        catch {
          // Cache entry removed before loading resolved; nothing to clean up.
        }
      },
    }),
    getDailyMissions: build.query<MissionsState | null, string>({
      // The RPC is auth-scoped, so the arg is only the cache-tag id.
      queryFn: async () => {
        try {
          return {data: await fetchDailyMissions()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, userId) => [{
        type: "DailyMissions",
        id: userId,
      }], // One Realtime channel lives exactly as long as the cache entry: it
      // subscribes only after data is cached and is always removed on exit.
      // Row events are partial, so they invalidate rather than patch the
      // aggregate the RPC returns.
      async onCacheEntryAdded(userId, {
        cacheDataLoaded,
        cacheEntryRemoved,
        dispatch,
      }) {
        if (!isSupabaseConfigured) return
        let channel: ReturnType<typeof supabase.channel> | null = null
        try {
          await cacheDataLoaded
          const invalidate = () => {
            dispatch(lobbyApi.util.invalidateTags([{
              type: "DailyMissions",
              id: userId,
            }]))
          }
          channel = supabase
            .channel(`missions:${userId}`)
            .on("postgres_changes", {
              event: "*",
              schema: "public",
              table: "player_daily_missions",
              filter: `profile_id=eq.${userId}`,
            }, invalidate)
            .on("postgres_changes", {
              event: "*",
              schema: "public",
              table: "player_weekly_pass",
              filter: `profile_id=eq.${userId}`,
            }, invalidate)
            .on("postgres_changes", {
              event: "*",
              schema: "public",
              table: "player_streak",
              filter: `profile_id=eq.${userId}`,
            }, invalidate)
            .subscribe()
          await cacheEntryRemoved
        }
        catch {
          // Cache entry removed before data loaded; the channel never existed.
        }
        finally {
          if (channel) void supabase.removeChannel(channel)
        }
      },
    }),
    getTableConfigs: build.query<readonly TableConfigRow[], TableConfigRow["kind"]>({
      queryFn: async (kind) => {
        try {
          return {data: await fetchTableConfigs(kind)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, kind) => [{
        type: "TableConfigs",
        id: kind,
      }],
      keepUnusedDataFor: 1800,
    }),
    getActivePodium: build.query<string | null, void>({
      queryFn: async () => {
        try {
          return {data: await fetchActivePodium()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: [{type: "ActivePodium"}],
      keepUnusedDataFor: 1800,
    }),
    claimDailyBonus: build.mutation<ClaimDailyBonusResult | null, {userId: string}>({
      queryFn: async () => {
        try {
          return {data: await claimDailyBonus()}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // DailyBonusState invalidates immediately so canClaim flips as soon as
      // the RPC succeeds. Wallet/Profile refresh is deliberately delayed by
      // the dailyBonusClaimConfirmed listener so the reward-flight tokens
      // land on the balance before it ticks up.
      invalidatesTags: (_result, _error, {userId}) => [{
        type: "DailyBonusState",
        id: userId,
      }],
      async onQueryStarted({userId}, {
        queryFulfilled,
        dispatch,
      }) {
        try {
          await queryFulfilled
          // Wallet/Profile refresh is a delayed workflow owned by the
          // dailyBonusClaimConfirmed listener in features/lobby/dailyBonusListeners.ts.
          dispatch(dailyBonusClaimConfirmed({userId}))
        }
        catch {
          // Failed claim: no domain event, so no delayed refresh is scheduled.
        }
      },
    }),
    purchaseBoardWithGems: build.mutation<void, {boardId: string, userId: string}>({
      queryFn: async ({boardId}) => {
        try {
          await purchaseBoardWithGems(boardId)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // Corrects the old stale-wallet behavior: the gem purchase must be
      // reflected in both the owned-board inventory and the wallet.
      invalidatesTags: (_result, _error, {userId}) => [{
        type: "BoardInventory",
        id: userId,
      }, {
        type: "Wallet",
        id: userId,
      }],
    }),
    spinWheel: build.mutation<WheelSpinResult, {configId: string}>({
      queryFn: async ({configId}) => {
        try {
          return {data: await spinWheel(configId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // No invalidatesTags: the UI must not re-read the wheel until its
      // reward animation finishes, so the caller will explicitly
      // refresh/invalidate after it finishes.
    }),
    claimMission: build.mutation<ClaimMissionResult | null, {missionId: string, userId: string}>({
      queryFn: async ({missionId}) => {
        try {
          return {data: await claimMission(missionId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, {userId}) => [{
        type: "DailyMissions",
        id: userId,
      }],
    }),
    rerollMission: build.mutation<void, {missionId: string, userId: string}>({
      queryFn: async ({missionId}) => {
        try {
          await rerollMission(missionId)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, {userId}) => [{
        type: "DailyMissions",
        id: userId,
      }],
    }),
    claimStreakChest: build.mutation<void, {userId: string}>({
      queryFn: async () => {
        try {
          await claimStreakChest()
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, {userId}) => [{
        type: "DailyMissions",
        id: userId,
      }],
    }),
    markTutorialComplete: build.mutation<void, void>({
      queryFn: async () => {
        try {
          await markTutorialComplete()
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
    abandonStaleMatches: build.mutation<number, number>({
      queryFn: async (maxAgeMinutes) => {
        try {
          return {data: await abandonStaleMatches(maxAgeMinutes)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
    }),
  }),
})

export const {
  useGetLobbyBoardsQuery,
  useGetUserBoardInventoryQuery,
  useGetLobbyFeatureConfigsQuery,
  useGetDailyBonusConfigsQuery,
  useGetDailyBonusStateQuery,
  useGetWheelStateQuery,
  useGetDailyMissionsQuery,
  useGetTableConfigsQuery,
  useGetActivePodiumQuery,
  useClaimDailyBonusMutation,
  usePurchaseBoardWithGemsMutation,
  useSpinWheelMutation,
  useClaimMissionMutation,
  useRerollMissionMutation,
  useClaimStreakChestMutation,
  useMarkTutorialCompleteMutation,
  useAbandonStaleMatchesMutation,
} = lobbyApi
