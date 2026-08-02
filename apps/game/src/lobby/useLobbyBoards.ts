import { useMemo } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useGetLobbyBoardsQuery } from '../features/lobby/lobbyApi';
import { lobbyBoardFromConfig, lobbyBoards, type LobbyBoard } from './lobbyData';

export interface LobbyBoardsResult {
  readonly boards: readonly LobbyBoard[];
  /** True while the Supabase fetch for board configs is in flight.
   *  Stays false when Supabase isn't configured (nothing to wait for). */
  readonly isLoading: boolean;
}

export function useLobbyBoards(): LobbyBoardsResult {
  const { data, isLoading, isUninitialized } = useGetLobbyBoardsQuery(undefined, {
    skip: !isSupabaseConfigured,
  });

  const boards = useMemo(() => {
    const remoteBoards = data?.map(lobbyBoardFromConfig) ?? [];
    const remoteIds = new Set(remoteBoards.map((board) => board.id));
    return [
      ...remoteBoards,
      ...lobbyBoards.filter((board) => !remoteIds.has(board.id)),
    ];
  }, [data]);

  return {
    boards,
    // A fresh subscription renders uninitialized (isLoading false) for one
    // frame before the fetch starts; count that wait so the lobby loading
    // gate never lifts before the first fetch settles. Skipped (unconfigured)
    // queries stay uninitialized forever, so only count it when Supabase is
    // configured.
    isLoading: isLoading || (isSupabaseConfigured && isUninitialized),
  };
}
