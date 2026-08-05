import type {PayloadAction} from "@reduxjs/toolkit"
import {createSlice} from "@reduxjs/toolkit"

import type {Position} from "../../../../../packages/engine/src/types"

// Absorbs a refresh blip; short enough that a tab-close forfeit still feels immediate.
export const PRESENCE_FORFEIT_GRACE_MS = 1500

// Difficulty-room matches override this via the route-entry payload so the
// threshold scales with the room's turn timer.
export const DEFAULT_INACTIVITY_FORFEIT_MS = 5 * 60 * 1000

// Delay so the player registers the turn change before the dice fly.
export const ONLINE_AUTO_ROLL_DELAY_MS = 350

// 'unknown' = no presence sync received yet — callers must not act on it.
// 'offline' + `opponentEverOnline` distinguishes "never showed up" from "left".
export type OpponentPresence = "unknown" | "online" | "offline"

/**
 * Client-only state for the online-match route. Everything else about a
 * session is server rows in the getActiveMatch cache entry that selectors read.
 */
export type OnlineMatchState = {
  readonly selectedFrom: Position | null,
  /**
   * The `opponentPreviewKey` of the opponent turn whose move preview has been
   * shown. Compared to the derived key of the current turn: a new turn (new
   * key) reads as "not revealed yet" until the reveal delay elapses.
   */
  readonly opponentPreviewReadyKey: string | null,

  // Listeners take no arguments, so workflows read the active match id here;
  // read selectors keep taking `matchId` themselves — not a second source of truth.
  readonly matchId: string | null,

  // Mount-time floor for both activity clocks: a freshly loaded page cannot
  // forfeit immediately against a stale database row.
  readonly sessionStartedMs: number,

  readonly turnSeconds: number | null, // null = no visible timer
  readonly inactivityForfeitMs: number,

  // lastLocalActivityMs drives the turn timer; lastOpponentActivityMs drives the claim.
  readonly lastLocalActivityMs: number | null,
  readonly lastOpponentActivityMs: number | null,
  readonly opponentDisconnectedAt: number | null,
  readonly opponentPresence: OpponentPresence,
  readonly opponentEverOnline: boolean,
  readonly inactivityClaimAvailable: boolean,
}

export type OnlineMatchRouteEnteredPayload = {
  readonly matchId: string | null,
  readonly sessionStartedMs: number,
  readonly turnSeconds: number | null,
  readonly inactivityForfeitMs: number,
}

export function createInitialOnlineMatchState(): OnlineMatchState {
  return {
    selectedFrom: null,
    opponentPreviewReadyKey: null,
    matchId: null,
    sessionStartedMs: 0,
    turnSeconds: null,
    inactivityForfeitMs: DEFAULT_INACTIVITY_FORFEIT_MS,
    lastLocalActivityMs: null,
    lastOpponentActivityMs: null,
    opponentDisconnectedAt: null,
    opponentPresence: "unknown",
    opponentEverOnline: false,
    inactivityClaimAvailable: false,
  }
}

export const onlineMatchSlice = createSlice({
  name: "onlineMatch",
  initialState: createInitialOnlineMatchState(),
  reducers: {
    onlineMatchRouteEntered: (_state, action: PayloadAction<OnlineMatchRouteEnteredPayload>) => {
      // Re-entry resets rather than merges; StrictMode's double-mount is just
      // two idempotent resets.
      return {
        ...createInitialOnlineMatchState(),
        matchId: action.payload.matchId,
        sessionStartedMs: action.payload.sessionStartedMs,
        turnSeconds: action.payload.turnSeconds,
        inactivityForfeitMs: action.payload.inactivityForfeitMs,
      }
    },
    onlineMatchRouteExited: () => createInitialOnlineMatchState(), // The legal-origin guard lives in the hook's selectFrom: a reducer cannot
    // read the query cache, and the cache is where legal moves are derived.
    checkerSelected: (state, action: PayloadAction<{readonly from: Position}>) => {
      state.selectedFrom = action.payload.from
    },
    checkerSelectionCancelled: (state) => {
      state.selectedFrom = null
    },
    opponentPreviewRevealed: (state, action: PayloadAction<{readonly key: string}>) => {
      state.opponentPreviewReadyKey = action.payload.key
    },
    localActivityObserved: (state, action: PayloadAction<{readonly atMs: number}>) => {
      state.lastLocalActivityMs = action.payload.atMs
    },
    opponentActivityObserved: (state, action: PayloadAction<{readonly atMs: number}>) => {
      state.lastOpponentActivityMs = action.payload.atMs
      // Fresh opponent activity revokes an armed inactivity claim.
      state.inactivityClaimAvailable = false
    },
    opponentPresenceChanged: (state, action: PayloadAction<{readonly online: boolean, readonly atMs: number}>) => {
      if (action.payload.online) {
        state.opponentPresence = "online"
        state.opponentEverOnline = true
        state.opponentDisconnectedAt = null
      }
      else {
        state.opponentPresence = "offline"
        // Only online→offline counts as a disconnect (a still-loading opponent
        // must not start the clock); once set, later syncs never move it forward.
        if (state.opponentDisconnectedAt === null && state.opponentEverOnline) {
          state.opponentDisconnectedAt = action.payload.atMs
        }
      }
    },
    opponentInactivityDeadlineReached: (state) => {
      state.inactivityClaimAvailable = true
    },
  },
})

export const onlineMatchActions = onlineMatchSlice.actions

export const onlineMatchReducer = onlineMatchSlice.reducer
