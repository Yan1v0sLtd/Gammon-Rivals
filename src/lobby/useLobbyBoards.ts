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
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled || error || !data?.length) return;
        setBoards(data.map(lobbyBoardFromConfig));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return boards;
}
