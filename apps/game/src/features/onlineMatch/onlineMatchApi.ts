import type {Player} from "../../../../../packages/engine/src/types"
import {isSupabaseConfigured, supabase} from "../../lib/supabase"
import {type ApiError, baseApi, toApiError} from "../../store/baseApi"

import {
  acceptDouble,
  type AcceptDoubleArgs,
  type ActiveMatchSnapshot,
  cancelMatchForOwner,
  convertOpponentToAi,
  type ConvertOpponentToAiArgs,
  dropDouble,
  type DropDoubleArgs,
  fetchActiveMatch,
  finalizeMatch,
  type FinalizeMatchArgs,
  invokeAiMove,
  invokeFinishTurn,
  invokeRollDice,
  type MatchRow,
  offerDouble,
  updateCurrentTurn,
} from "./onlineMatchData"
import {isBenignCommandRace} from "./onlineMatchErrors"
import type {CurrentTurnJSON} from "./onlineMatchSelectors"

/** Fallback poll for a silently dropped Realtime socket. */
export const FALLBACK_POLL_MS = 8000

// Shared fixed cache keys so the duplicate-command guards (and, from 10d, the
// auto-action workflow) read the same pending state as the clicking component:
// roll_dice and finish_turn are server-authoritative and reject the second
// call, which used to surface as a spurious toast.
export function rollDiceCacheKey(matchId: string): string {
  return `online-roll:${matchId}`
}

export function finishTurnCacheKey(matchId: string): string {
  return `online-finish-turn:${matchId}`
}

/**
 * Roll and turn-commit share the benign-race allowlist: on those reasons the
 * server view simply advanced past us, so the command reports success and the
 * invalidation below resyncs instead of surfacing an error.
 */
async function runRacingCommand(run: () => Promise<void>): Promise<{data: undefined} | {error: ApiError}> {
  try {
    await run()
    return {data: undefined}
  }
  catch (err) {
    const apiError = toApiError(err)
    if (isBenignCommandRace(apiError.message)) return {data: undefined}
    return {error: apiError}
  }
}

function activeMatchTag(matchId: string) {
  return {
    type: "ActiveMatch",
    id: matchId,
  } as const
}

export const onlineMatchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getActiveMatch: build.query<ActiveMatchSnapshot, string>({
      queryFn: async (matchId) => {
        try {
          return {data: await fetchActiveMatch(matchId)}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      providesTags: (_result, _error, matchId) => [activeMatchTag(matchId)], // The entry anchors the channel below, so the 60s default would hold a
      // socket open on a match nobody is watching — and a retained snapshot is
      // stale the moment we stop listening to it.
      keepUnusedDataFor: 0, // Row events are partial, so they invalidate the aggregate rather than
      // patch it.
      async onCacheEntryAdded(matchId, {
        cacheDataLoaded,
        cacheEntryRemoved,
        dispatch,
        getCacheEntry,
      }) {
        if (!isSupabaseConfigured) return
        let channel: ReturnType<typeof supabase.channel> | null = null
        try {
          await cacheDataLoaded
          const invalidate = () => {
            dispatch(onlineMatchApi.util.invalidateTags([{
              type: "ActiveMatch",
              id: matchId,
            }]))
          }
          channel = supabase
            .channel(`match-${matchId}`)
            .on("postgres_changes", {
              event: "UPDATE",
              schema: "public",
              table: "matches",
              filter: `id=eq.${matchId}`,
            }, invalidate)
            .on("postgres_changes", {
              event: "INSERT",
              schema: "public",
              table: "moves",
            }, (payload) => {
              // Filtered here, not server-side: supabase-js has no dynamic
              // filter and re-subscribing when the game id changes between
              // games would drop events. Without the check, every moves INSERT
              // in the database wakes every client — RLS limits reads, not
              // realtime delivery.
              const row = payload?.new as {game_id?: string} | undefined
              const entry = getCacheEntry().data
              const targetGameId = entry?.currentGame?.id ?? entry?.match?.current_game_id ?? null
              if (!targetGameId || row?.game_id !== targetGameId) return
              invalidate()
            })
            .subscribe((status) => {
              // The channel only goes live some time after the first fetch
              // resolved, and Realtime does not replay. Resync on join so a
              // move landing in that gap is not stranded until the poll —
              // and again on a silent reconnect, which re-fires this status.
              if (status === "SUBSCRIBED") invalidate()
            })
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
    rollDice: build.mutation<void, string>({
      queryFn: (matchId) => runRacingCommand(() => invokeRollDice(matchId)), // Only on success: a real failure left the server view untouched, and the
      // old callback returned without refreshing.
      invalidatesTags: (_result, error, matchId) => (error ? [] : [activeMatchTag(matchId)]),
    }),
    finishTurn: build.mutation<void, string>({
      queryFn: (matchId) => runRacingCommand(() => invokeFinishTurn(matchId)),
      invalidatesTags: (_result, error, matchId) => (error ? [] : [activeMatchTag(matchId)]),
    }),
    submitSubMove: build.mutation<void, {readonly matchId: string, readonly currentTurn: CurrentTurnJSON}>({
      queryFn: async ({
        matchId,
        currentTurn,
      }) => {
        try {
          await updateCurrentTurn(matchId, currentTurn as unknown as MatchRow["current_turn"])
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // Optimistic: the checker has to land under the finger, not after the
      // round-trip. A failed write rolls the patch back and the invalidation
      // re-reads the authoritative snapshot either way.
      async onQueryStarted({
        matchId,
        currentTurn,
      }, {
        dispatch,
        queryFulfilled,
      }) {
        const patch = dispatch(onlineMatchApi.util.updateQueryData("getActiveMatch", matchId, (draft) => {
          if (!draft.match) return
          draft.match.current_turn = currentTurn as unknown as MatchRow["current_turn"]
        }))
        try {
          await queryFulfilled
        }
        catch {
          patch.undo()
        }
      },
      invalidatesTags: (_result, _error, {matchId}) => [activeMatchTag(matchId)],
    }),
    offerDouble: build.mutation<void, {readonly matchId: string, readonly offeredBy: Player}>({
      queryFn: async ({
        matchId,
        offeredBy,
      }) => {
        try {
          await offerDouble(matchId, offeredBy)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // Unconditional, as the cube callbacks always refreshed: a partially
      // applied cube write must not leave a stale local view.
      invalidatesTags: (_result, _error, {matchId}) => [activeMatchTag(matchId)],
    }),
    acceptDouble: build.mutation<void, AcceptDoubleArgs>({
      queryFn: async (args) => {
        try {
          await acceptDouble(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, {matchId}) => [activeMatchTag(matchId)],
    }),
    dropDouble: build.mutation<void, DropDoubleArgs>({
      queryFn: async (args) => {
        try {
          await dropDouble(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, {matchId}) => [activeMatchTag(matchId)],
    }),
    cancelMatch: build.mutation<void, string>({
      queryFn: async (matchId) => {
        try {
          await cancelMatchForOwner(matchId)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      },
      invalidatesTags: (_result, _error, matchId) => [activeMatchTag(matchId)],
    }),
    finalizeMatch: build.mutation<void, FinalizeMatchArgs & {readonly userId: string | null}>({
      queryFn: async (args) => {
        try {
          await finalizeMatch(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // finish_match grants the PvP prize + XP and moves the ELO, so the
      // player-data consumers refresh through invalidation rather than a manual
      // refetch call.
      invalidatesTags: (_result, error, {
        matchId,
        userId,
      }) => {
        if (error) return []
        if (userId === null) return [activeMatchTag(matchId)]
        return [activeMatchTag(matchId), {
          type: "Wallet",
          id: userId,
        }, {
          type: "Profile",
          id: userId,
        }, {
          type: "XpBoost",
          id: userId,
        }]
      },
    }), // Unconditional on purpose: the old poke effect refreshed on success and
    // failure alike; this file's other mutations invalidate conditionally.
    aiMove: build.mutation<void, string>({
      queryFn: (matchId) => runRacingCommand(() => invokeAiMove(matchId)),
      invalidatesTags: (_result, _error, matchId) => [activeMatchTag(matchId)],
    }),
    convertOpponentToAi: build.mutation<void, ConvertOpponentToAiArgs>({
      queryFn: async (args) => {
        try {
          await convertOpponentToAi(args)
          return {data: undefined}
        }
        catch (err) {
          return {error: toApiError(err)}
        }
      }, // Error deliberately not swallowed (the listener classifies it); no tags
      // on error, because the old effect never refreshed on a conversion failure.
      invalidatesTags: (_result, error, {matchId}) => (error ? [] : [activeMatchTag(matchId)]),
    }),
  }),
})

export const {
  useGetActiveMatchQuery,
  useRollDiceMutation,
  useFinishTurnMutation,
  useSubmitSubMoveMutation,
  useOfferDoubleMutation,
  useAcceptDoubleMutation,
  useDropDoubleMutation,
  useCancelMatchMutation,
  useFinalizeMatchMutation,
} = onlineMatchApi
