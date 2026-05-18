import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { lobbyBoardFromConfig, lobbyBoards, type LobbyBoard } from './lobbyData';

export interface LobbyBoardsResult {
  readonly boards: readonly LobbyBoard[];
  /** True while the Supabase fetch for board configs is in flight.
   *  Stays false when Supabase isn't configured (nothing to wait for). */
  readonly isLoading: boolean;
}

export function useLobbyBoards(): LobbyBoardsResult {
  const [boards, setBoards] = useState<readonly LobbyBoard[]>(lobbyBoards);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void supabase
      .from('board_theme_configs')
      .select('*')
      .eq('is_enabled', true)
      // Highest sort_order first so the operator can prioritise a
      // featured board by giving it the biggest number.
      .order('sort_order', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setIsLoading(false);
        if (error || !data?.length) return;
        const remoteBoards = data.map(lobbyBoardFromConfig);
        const remoteIds = new Set(remoteBoards.map((board) => board.id));
        setBoards([
          ...remoteBoards,
          ...lobbyBoards.filter((board) => !remoteIds.has(board.id)),
        ]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { boards, isLoading };
}
