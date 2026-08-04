import {useEffect, useRef} from "react"

import {skipToken} from "@reduxjs/toolkit/query"
import {useNavigate} from "react-router-dom"

import {matchEntryPath} from "../../game/matchEntryPath"
import {isSupabaseConfigured} from "../../lib/supabase"
import type {DifficultySelection, MatchmakingOverlayState} from "../../lobby/DifficultyModal"
import {useAppDispatch, useAppSelector} from "../../store/hooks"
import {useNavigationLoaderOverlay} from "../appUi/useNavigationLoaderOverlay"
import {selectAuthUserId, selectProfileProgression} from "../auth/authSelectors"

import {useGetLobbyBoardsQuery, useGetUserBoardInventoryQuery} from "./lobbyApi"
import {computeBoardState, selectOwnedBoardIds, selectSelectedLobbyBoard, selectEnteringRoomId, selectLobbyMatchmaking} from "./lobbySelectors"
import {difficultyErrorShown, matchmakingCancelled, matchmakingRequested} from "./lobbySlice"

export type LobbyMatchmakingControls = {
  readonly busyId: string | null,
  readonly overlay: MatchmakingOverlayState | undefined,
  readonly start: (selection: DifficultySelection) => void,
  readonly cancel: () => void,
}

export function useLobbyMatchmaking(): LobbyMatchmakingControls {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const {show: showOverlay} = useNavigationLoaderOverlay()
  const userId = useAppSelector(selectAuthUserId)
  const progression = useAppSelector(selectProfileProgression)
  const selectedLobbyBoard = useAppSelector(selectSelectedLobbyBoard)
  const ownedIds = useAppSelector(selectOwnedBoardIds)
  const matchmaking = useAppSelector(selectLobbyMatchmaking)
  const busyId = useAppSelector(selectEnteringRoomId)
  useGetLobbyBoardsQuery(undefined, {skip: !isSupabaseConfigured})
  useGetUserBoardInventoryQuery(userId ?? skipToken, {skip: !isSupabaseConfigured})

  const start = (selection: DifficultySelection) => {
    if (busyId !== null) return
    if (!userId) {
      dispatch(difficultyErrorShown({message: "Sign in to enter a room."}))
      return
    }
    const {selectedBoard} = selectedLobbyBoard
    if (selectedBoard) {
      const state = computeBoardState({
        boardId: selectedBoard.id,
        unlockLevel: selectedBoard.unlockLevel,
        priceGems: selectedBoard.priceGems,
        ownedIds,
        playerLevel: progression.level,
      })
      if (state !== "owned" && state !== "free-unlock") {
        dispatch(difficultyErrorShown({message: "Unlock this board before entering a room."}))
        return
      }
    }
    dispatch(matchmakingRequested({
      searchingForTier: selection.tableConfigId,
      tierDisplayName: selection.displayName,
      matchTarget: selection.matchTarget,
      turnSeconds: selection.turnSeconds,
    }))
  }

  const navigatedRef = useRef(false)
  useEffect(() => {
    if (matchmaking.status !== "matched" || navigatedRef.current) return
    navigatedRef.current = true
    showOverlay()
    navigate(matchEntryPath({
      matchId: matchmaking.matchId,
      target: matchmaking.target,
      turnSeconds: matchmaking.turnSeconds,
      mode: matchmaking.mode,
      boardId: selectedLobbyBoard.effectiveSelectedBoardId,
    }))
  }, [matchmaking, showOverlay, navigate, selectedLobbyBoard.effectiveSelectedBoardId])

  return {
    busyId,
    overlay: matchmaking.status === "idle" ? undefined : matchmaking,
    start,
    cancel: () => dispatch(matchmakingCancelled()),
  }
}
