import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useNavigationLoaderOverlay } from '../features/appUi/useNavigationLoaderOverlay';
import {
  difficultyErrorShown,
  matchmakingCancelled,
  matchmakingRequested,
} from '../features/lobby/lobbySlice';
import { selectEnteringRoomId, selectLobbyMatchmaking } from '../features/lobby/lobbySelectors';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { DifficultySelection, MatchmakingOverlayState } from './DifficultyModal';
import { useSelectedLobbyBoard } from './useSelectedLobbyBoard';
import { computeBoardState, useUserBoardInventory } from './useUserBoardInventory';

export interface LobbyMatchmakingControls {
  /** table_config_id whose enter-room call is in flight (disables that tier card). */
  readonly busyId: string | null;
  /** Slice matchmaking state, shape-compatible with MatchmakingOverlayState. */
  readonly overlay: MatchmakingOverlayState | undefined;
  readonly start: (selection: DifficultySelection) => void;
  readonly cancel: () => void;
}

/**
 * React face of the matchmaking listener: validates the request, mirrors
 * slice state into the modal, navigates on match. No RPC calls or timers.
 */
export function useLobbyMatchmaking(): LobbyMatchmakingControls {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { show: showOverlay } = useNavigationLoaderOverlay();
  const { user, progression } = useAuth();
  const { ownedIds } = useUserBoardInventory();
  const { effectiveSelectedBoardId, selectedBoard } = useSelectedLobbyBoard();
  const matchmaking = useAppSelector(selectLobbyMatchmaking);
  const busyId = useAppSelector(selectEnteringRoomId);

  const start = (selection: DifficultySelection) => {
    if (busyId !== null) return;
    if (!user) {
      dispatch(difficultyErrorShown({ message: 'Sign in to enter a room.' }));
      return;
    }
    if (selectedBoard) {
      const state = computeBoardState({
        boardId: selectedBoard.id,
        unlockLevel: selectedBoard.unlockLevel,
        priceGems: selectedBoard.priceGems,
        ownedIds,
        playerLevel: progression.level,
      });
      if (state !== 'owned' && state !== 'free-unlock') {
        dispatch(difficultyErrorShown({ message: 'Unlock this board before entering a room.' }));
        return;
      }
    }
    dispatch(
      matchmakingRequested({
        searchingForTier: selection.tableConfigId,
        tierDisplayName: selection.displayName,
        matchTarget: selection.matchTarget,
        turnSeconds: selection.turnSeconds,
      })
    );
  };

  const cancel = () => {
    dispatch(matchmakingCancelled());
  };

  // The slice keeps the 'matched' state (the overlay stays rendered until the
  // route change), so guard the navigation to fire it exactly once.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (matchmaking.status !== 'matched' || navigatedRef.current) return;
    navigatedRef.current = true;

    const { matchId, target, turnSeconds, mode } = matchmaking;
    const params = new URLSearchParams();
    params.set('opp', mode === 'pvp' ? 'pvp' : mode);
    params.set('target', String(target));
    // `board` is THIS PLAYER's theme, written into their own URL only — the
    // opponent writes their own, so both differ on the same matchId. Theme
    // is per-client cosmetic, not a matchmaking dimension.
    params.set('board', effectiveSelectedBoardId);
    params.set('matchId', matchId);
    params.set('turn', String(turnSeconds));
    showOverlay();
    // Online matches (PvP or server-bot, mode='online') route to /play; legacy AI fallbacks to /hotseat.
    navigate(
      mode === 'pvp' || mode === 'online'
        ? `/play/${matchId}?${params.toString()}`
        : `/hotseat?${params.toString()}`
    );
  }, [matchmaking, showOverlay, navigate, effectiveSelectedBoardId]);

  return {
    busyId,
    overlay: matchmaking.status === 'idle' ? undefined : matchmaking,
    start,
    cancel,
  };
}
