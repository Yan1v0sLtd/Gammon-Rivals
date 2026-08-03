import { useAppSelector } from '../store/hooks';
import { selectLobbySelectedBoardId } from '../features/lobby/lobbySelectors';
import { useLobbyBoards } from './useLobbyBoards';
import type { LobbyBoard } from './lobbyData';

export interface SelectedLobbyBoard {
  readonly boards: readonly LobbyBoard[];
  readonly isLoading: boolean;
  readonly effectiveSelectedBoardId: string;
  readonly selectedBoard: LobbyBoard | undefined;
}

/**
 * Slice owns the selected board id; RTK Query owns the rows. Falls back to
 * the first configured board until the player picks one.
 */
export function useSelectedLobbyBoard(): SelectedLobbyBoard {
  const { boards, isLoading } = useLobbyBoards();
  const selectedBoardId = useAppSelector(selectLobbySelectedBoardId);

  const effectiveSelectedBoardId = boards.some((board) => board.id === selectedBoardId)
    ? selectedBoardId
    : (boards[0]?.id ?? '');
  const selectedBoard = boards.find((board) => board.id === effectiveSelectedBoardId) ?? boards[0];

  return { boards, isLoading, effectiveSelectedBoardId, selectedBoard };
}
