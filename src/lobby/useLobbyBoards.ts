import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { lobbyBoardFromConfig, lobbyBoards, type LobbyBoard } from './lobbyData';

export function useLobbyBoards(): readonly LobbyBoard[] {
  const [boards, setBoards] = useState<readonly LobbyBoard[]>(lobbyBoards);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    void supabase
      .from('board_theme_configs')
      .select('*')
      .eq('is_enabled', true)
      // Highest sort_order first so the operator can prioritise a
      // featured board by giving it the biggest number.
      .order('sort_order', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled || error || !data?.length) return;
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

  return boards;
}
