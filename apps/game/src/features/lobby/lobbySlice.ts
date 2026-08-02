import type {PayloadAction} from '@reduxjs/toolkit';
import {createSlice} from '@reduxjs/toolkit';

/**
 * Matchmaking search budget and poll cadence, shared by the slice default
 * and the listener so the two can never drift apart.
 */
export const MATCHMAKING_MAX_SECONDS = 4;
export const MATCHMAKING_POLL_MS = 500;

/** How long the just-claimed reward stays visible before the modal auto-closes. */
export const DAILY_BONUS_CLAIMED_MODAL_MS = 1800;

/** Reward shape shared by the claim listener, the slice, and the modal. */
export interface ClaimedDailyReward {
  readonly day: number;
  readonly coins: number;
  readonly gems: number;
  readonly xp: number;
}

/**
 * One full-screen lobby modal at a time. Error/result state lives inside
 * each variant so opening a modal structurally resets it — a stale error
 * can never bleed across modals.
 */
export type LobbyModal = | { kind: 'none' } | { kind: 'difficulty'; error: string | null } | {
  kind: 'boardPurchase'; boardId: string; error: string | null
} | { kind: 'dailyBonus'; error: string | null; justClaimed: ClaimedDailyReward | null } | { kind: 'wheel' } | {
  kind: 'howToPlay'
} | { kind: 'missions' };

/**
 * PvP-first matchmaking workflow. The `matched` variant keeps the search
 * fields because the overlay stays rendered until the route change.
 */
export type MatchmakingState = | { status: 'idle' } | {
  status: 'searching'; searchingForTier: string; tierDisplayName: string; elapsedSeconds: number; maxSeconds: number;
} | {
  status: 'matched';
  searchingForTier: string;
  tierDisplayName: string;
  elapsedSeconds: number;
  maxSeconds: number;
  matchId: string;
  target: number;
  turnSeconds: number; // 'pvp' | 'online' | 'easy' | 'medium' | 'hard' — plain string from the server RPCs.
  mode: string;
};

/**
 * Lobby client state. Board rows stay in RTK Query — the slice holds only
 * id strings so it stays strictly serializable.
 */
export interface LobbyState {
  readonly selectedBoardId: string;
  readonly modal: LobbyModal;
  readonly dailyBonusAutoOpened: boolean;
  readonly matchmaking: MatchmakingState;
}

export function createInitialLobbyState(): LobbyState {
  return {
    selectedBoardId: '',
    modal: {kind: 'none'},
    dailyBonusAutoOpened: false,
    matchmaking: {status: 'idle'},
  };
}

interface ErrorMessagePayload {
  readonly message: string;
}

interface MatchmakingRequestedPayload {
  readonly searchingForTier: string;
  readonly tierDisplayName: string;
  // Request context only (RPC-omitted target/turn_seconds fallbacks) — not view state.
  readonly matchTarget: number;
  readonly turnSeconds: number;
}

interface MatchmakingTickedPayload {
  readonly elapsedSeconds: number;
}

interface MatchmakingMatchedPayload {
  readonly matchId: string;
  readonly target: number;
  readonly turnSeconds: number;
  readonly mode: string;
}

export const lobbySlice = createSlice({
  name: 'lobby',
  initialState: createInitialLobbyState(),
  reducers: {
    lobbyRouteEntered: () => createInitialLobbyState(),
    lobbyRouteExited: () => createInitialLobbyState(),
    boardSelected(state, action: PayloadAction<string>) {
      state.selectedBoardId = action.payload;
    },
    difficultyModalOpened(state) {
      state.modal = {
        kind: 'difficulty',
        error: null
      };
    },
    boardPurchaseModalOpened(state, action: PayloadAction<string>) {
      state.modal = {
        kind: 'boardPurchase',
        boardId: action.payload,
        error: null
      };
    },
    dailyBonusModalOpened(state) {
      state.modal = {
        kind: 'dailyBonus',
        error: null,
        justClaimed: null
      };
    },
    wheelModalOpened(state) {
      state.modal = {kind: 'wheel'};
    },
    howToPlayModalOpened(state) {
      state.modal = {kind: 'howToPlay'};
    },
    missionsModalOpened(state) {
      state.modal = {kind: 'missions'};
    },
    dailyBonusAutoOpenRequested(state) {
      // An automatic open must not preempt a modal the player opened.
      if (state.modal.kind !== 'none') return;
      // An effect may re-dispatch on every render, so open at most once per session.
      if (state.dailyBonusAutoOpened) return;
      state.dailyBonusAutoOpened = true;
      state.modal = {
        kind: 'dailyBonus',
        error: null,
        justClaimed: null
      };
    },
    lobbyModalClosed(state) {
      state.modal = {kind: 'none'};
    },
    boardPurchaseFailed(state, action: PayloadAction<ErrorMessagePayload>) {
      // Guard so a late mutation error can't attach to a different (or no) modal.
      if (state.modal.kind !== 'boardPurchase') return;
      state.modal.error = action.payload.message;
    },
    dailyBonusClaimFailed(state, action: PayloadAction<ErrorMessagePayload>) {
      if (state.modal.kind !== 'dailyBonus') return;
      state.modal.error = action.payload.message;
    },
    dailyBonusClaimSucceeded(state, action: PayloadAction<ClaimedDailyReward>) {
      if (state.modal.kind !== 'dailyBonus') return;
      state.modal.justClaimed = action.payload;
      state.modal.error = null;
    },
    difficultyErrorShown(state, action: PayloadAction<ErrorMessagePayload>) {
      // Component-side validation — the workflow is dead before it started, so also abandon any search.
      state.matchmaking = {status: 'idle'};
      if (state.modal.kind === 'difficulty') {
        state.modal.error = action.payload.message;
      }
    },
    matchmakingRequested(state, action: PayloadAction<MatchmakingRequestedPayload>) {
      state.matchmaking = {
        status: 'searching',
        searchingForTier: action.payload.searchingForTier,
        tierDisplayName: action.payload.tierDisplayName,
        elapsedSeconds: 0,
        maxSeconds: MATCHMAKING_MAX_SECONDS,
      };
      if (state.modal.kind === 'difficulty') {
        state.modal.error = null;
      }
    },
    matchmakingTicked(state, action: PayloadAction<MatchmakingTickedPayload>) {
      // Guarded so a tick from a cancelled/timed-out workflow can't resurrect the overlay.
      if (state.matchmaking.status !== 'searching') return;
      state.matchmaking.elapsedSeconds = Math.min(state.matchmaking.maxSeconds, Math.max(0, action.payload.elapsedSeconds));
    },
    matchmakingMatched(state, action: PayloadAction<MatchmakingMatchedPayload>) {
      if (state.matchmaking.status !== 'searching') return;
      state.matchmaking = {
        status: 'matched',
        searchingForTier: state.matchmaking.searchingForTier,
        tierDisplayName: state.matchmaking.tierDisplayName,
        elapsedSeconds: state.matchmaking.elapsedSeconds,
        maxSeconds: state.matchmaking.maxSeconds,
        matchId: action.payload.matchId,
        target: action.payload.target,
        turnSeconds: action.payload.turnSeconds,
        mode: action.payload.mode,
      };
    },
    matchmakingCancelled(state) {
      // Only a live search is cancellable: once matched, the routing payload
      // must survive until the navigation effect consumes it.
      if (state.matchmaking.status !== 'searching') return;
      // Back to idle; the difficulty modal stays open underneath.
      state.matchmaking = {status: 'idle'};
    },
    matchmakingFailed(state, action: PayloadAction<ErrorMessagePayload>) {
      state.matchmaking = {status: 'idle'};
      if (state.modal.kind === 'difficulty') {
        state.modal.error = action.payload.message;
      }
    },
  },
});

export const {
  lobbyRouteEntered,
  lobbyRouteExited,
  boardSelected,
  difficultyModalOpened,
  boardPurchaseModalOpened,
  dailyBonusModalOpened,
  wheelModalOpened,
  howToPlayModalOpened,
  missionsModalOpened,
  dailyBonusAutoOpenRequested,
  lobbyModalClosed,
  boardPurchaseFailed,
  dailyBonusClaimFailed,
  dailyBonusClaimSucceeded,
  difficultyErrorShown,
  matchmakingRequested,
  matchmakingTicked,
  matchmakingMatched,
  matchmakingCancelled,
  matchmakingFailed,
} = lobbySlice.actions;

export default lobbySlice.reducer;
