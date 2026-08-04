import {isAnyOf, TaskAbortError} from "@reduxjs/toolkit"

import {isSupabaseConfigured} from "../../lib/supabase"
import {baseApi} from "../../store/baseApi"
import type {AppStartListening} from "../../store/listenerTypes"

import {lobbyApi} from "./lobbyApi"
import {matchmakingErrorMessage} from "./lobbyErrors"
import {
  lobbyRouteExited,
  MATCHMAKING_MAX_SECONDS,
  MATCHMAKING_POLL_MS,
  matchmakingCancelled,
  matchmakingFailed,
  matchmakingMatched,
  matchmakingRequested,
  matchmakingTicked,
  lobbyRouteEntered,
} from "./lobbySlice"
import {cancelMatchmakingRpc, enterRoomAiFallback, findMatchInTier} from "./matchmakingData"

/**
 * PvP-first match entry: poll find_match_in_tier, then AI fallback on
 * timeout. A new request supersedes a running loop; cancel/route-exit own
 * the server-side queue cleanup.
 */
export function startMatchmakingListeners(startListening: AppStartListening): void {
  startListening({
    actionCreator: lobbyRouteEntered,
    effect: async (_action, {cancelActiveListeners, dispatch, getState, pause}) => {
      cancelActiveListeners()
      const userId = getState().auth.userId
      if (!isSupabaseConfigured || userId === null) return

      try {
        const abandonedCount = await pause(dispatch(lobbyApi.endpoints.abandonStaleMatches.initiate(1, {track: false})).unwrap())
        // The RPC may finish after auth changes; never refresh another user's wallet.
        if (getState().auth.userId !== userId || abandonedCount <= 0) return
        dispatch(baseApi.util.invalidateTags([{type: "Wallet", id: userId}]))
      }
      catch (err) {
        if (err instanceof TaskAbortError) return
        console.warn("abandonStaleMatches failed", err)
      }
    },
  })

  startListening({
    matcher: isAnyOf(matchmakingRequested, matchmakingCancelled, lobbyRouteExited),
    effect: async (action, {
      cancelActiveListeners,
      delay,
      dispatch,
      getState,
      getOriginalState,
      pause,
    }) => {
      cancelActiveListeners()

      // Cancel/exit owns queue cleanup, and only while a search was running:
      // cancel_matchmaking must not touch an already-matched queue row.
      // getOriginalState because the reducer has already processed the action.
      if (!matchmakingRequested.match(action)) {
        if (getOriginalState().lobby.matchmaking.status === "searching") {
          void cancelMatchmakingRpc().catch(() => undefined)
        }
        return
      }

      // The server debits the entry fee when it pairs/creates the match.
      const refreshWallet = () => {
        const userId = getState().auth.userId
        if (userId === null) return
        dispatch(baseApi.util.invalidateTags([{
          type: "Wallet",
          id: userId,
        }]))
      }

      const {
        searchingForTier,
        matchTarget,
        turnSeconds,
      } = action.payload
      const searchStart = Date.now()

      try {
        while (Date.now() - searchStart < MATCHMAKING_MAX_SECONDS * 1000) {
          const result = await pause(findMatchInTier({tableConfigId: searchingForTier}))
          if (result.status === "matched" && result.matchId) {
            refreshWallet()
            // The RPC may omit target/turn_seconds on matched rows — fall back
            // to the tier config carried on the request.
            dispatch(matchmakingMatched({
              matchId: result.matchId,
              target: result.target ?? matchTarget,
              turnSeconds: result.turnSeconds ?? turnSeconds,
              mode: "pvp",
            }))
            return
          }
          dispatch(matchmakingTicked({elapsedSeconds: (Date.now() - searchStart) / 1000}))
          await delay(MATCHMAKING_POLL_MS)
        }

        // Timeout — drop the queue row, then let the server pick the AI tier.
        await pause(cancelMatchmakingRpc().catch(() => undefined))
        const fallback = await pause(enterRoomAiFallback({tableConfigId: searchingForTier}))
        refreshWallet()
        // Server-bot tiers route to /play (mode='online'); legacy tiers key
        // on the AI level the server picked.
        dispatch(matchmakingMatched({
          matchId: fallback.matchId,
          target: fallback.target,
          turnSeconds: fallback.turnSeconds,
          mode: fallback.isBot ? "online" : fallback.aiLevel,
        }))
      }
      catch (err) {
        // Cancellation is owned by the cancel/exit branch above.
        if (err instanceof TaskAbortError) return
        dispatch(matchmakingFailed({message: matchmakingErrorMessage(err)}))
        void cancelMatchmakingRpc().catch(() => undefined)
      }
    },
  })
}
