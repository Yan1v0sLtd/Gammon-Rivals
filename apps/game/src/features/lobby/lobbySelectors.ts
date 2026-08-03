import type { LobbyModal } from './lobbySlice';
import type { LobbyState } from './lobbySlice';
import type { MatchmakingState } from './lobbySlice';

/** Slice-of-root-state shape the lobby selectors read from. */
export interface LobbyRootState {
  readonly lobby: LobbyState;
}

// All values read by identity off the slice — createSelector would add noise without preventing a re-render.
export const selectLobbySelectedBoardId = (state: LobbyRootState): string =>
  state.lobby.selectedBoardId;

export const selectLobbyModal = (state: LobbyRootState): LobbyModal => state.lobby.modal;

export const selectLobbyMatchmaking = (state: LobbyRootState): MatchmakingState =>
  state.lobby.matchmaking;

export const selectEnteringRoomId = (state: LobbyRootState): string | null =>
  state.lobby.matchmaking.status === 'idle' ? null : state.lobby.matchmaking.searchingForTier;

export const selectIsLobbyModalOpen = (state: LobbyRootState): boolean =>
  state.lobby.modal.kind !== 'none';
