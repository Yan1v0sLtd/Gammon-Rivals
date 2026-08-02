import { useCallback, useMemo } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { useGetUserBoardInventoryQuery } from '../features/lobby/lobbyApi';

export interface UseUserBoardInventoryResult {
  readonly ownedIds: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

export function useUserBoardInventory(): UseUserBoardInventoryResult {
  const { user } = useAuth();
  const { data, isLoading, refetch } = useGetUserBoardInventoryQuery(
    user?.id ?? skipToken,
    { skip: !isSupabaseConfigured },
  );

  // The cache stores a serializable string[]; the Set is a transient
  // compatibility shape for existing consumers and is never cached.
  const ownedIds = useMemo(() => new Set(data ?? []), [data]);

  return {
    ownedIds,
    isLoading,
    refetch: useCallback(() => {
      void refetch();
    }, [refetch]),
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
