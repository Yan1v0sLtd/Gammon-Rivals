import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface UseUserBoardInventoryResult {
  readonly ownedIds: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

export function useUserBoardInventory(): UseUserBoardInventoryResult {
  const { user } = useAuth();
  const [ownedIds, setOwnedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setOwnedIds(new Set());
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void supabase
      .from('user_board_inventory')
      .select('board_theme_id')
      .eq('profile_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        setIsLoading(false);
        if (error || !data) return;
        setOwnedIds(new Set(data.map((row) => row.board_theme_id)));
      });

    return () => {
      cancelled = true;
    };
  }, [user, refreshToken]);

  return {
    ownedIds,
    isLoading,
    refetch: () => setRefreshToken((value) => value + 1),
  };
}

export type BoardOwnershipState = 'owned' | 'level-locked' | 'purchasable' | 'free-unlock';

export function computeBoardState(args: {
  readonly boardId: string;
  readonly unlockLevel: number;
  readonly priceGems: number;
  readonly ownedIds: ReadonlySet<string>;
  readonly playerLevel: number;
}): BoardOwnershipState {
  if (args.ownedIds.has(args.boardId)) return 'owned';
  if (args.playerLevel < args.unlockLevel) return 'level-locked';
  if (args.priceGems > 0) return 'purchasable';
  return 'free-unlock';
}
