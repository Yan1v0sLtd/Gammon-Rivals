import {createSelector} from "@reduxjs/toolkit"

import {createEmptyArray} from "../../lib/constants"
import type {RootState} from "../../store/store"
import {selectAuthUserId} from "../auth/authSelectors"

import {lobbyApi} from "./lobbyApi"
import {lobbyBoardFromConfig, lobbyBoards, type LobbyBoard} from "./lobbyBoardData"
import type {DailyBonusConfigRow, MissionsState, UserDailyBonusRow} from "./lobbyData"
import type {LobbyModal, LobbyState, MatchmakingState} from "./lobbySlice"

/** Slice-of-root-state shape the lobby selectors read from. */
export type LobbyRootState = {
  readonly lobby: LobbyState,
}

// All values read by identity off the slice — createSelector would add noise without preventing a re-render.
export const selectLobbySelectedBoardId = (state: LobbyRootState): string => state.lobby.selectedBoardId

export const selectLobbyModal = (state: LobbyRootState): LobbyModal => state.lobby.modal

export const selectLobbyMatchmaking = (state: LobbyRootState): MatchmakingState => state.lobby.matchmaking

export const selectEnteringRoomId = (state: LobbyRootState): string | null => state.lobby.matchmaking.status === "idle" ? null : state.lobby.matchmaking.searchingForTier

export const selectIsLobbyModalOpen = (state: LobbyRootState): boolean => state.lobby.modal.kind !== "none"

export const selectLobbyBoards = createSelector(
  [(state: RootState) => lobbyApi.endpoints.getLobbyBoards.select(undefined)(state).data],
  (configs): readonly LobbyBoard[] => {
    const remoteBoards = configs?.map(lobbyBoardFromConfig) ?? []
    const remoteIds = new Set(remoteBoards.map((board) => board.id))
    return [...remoteBoards, ...lobbyBoards.filter((board) => !remoteIds.has(board.id))]
  },
)

export const selectSelectedLobbyBoard = createSelector(
  [selectLobbyBoards, selectLobbySelectedBoardId],
  (boards, selectedBoardId) => {
    const effectiveSelectedBoardId = boards.some((board) => board.id === selectedBoardId)
      ? selectedBoardId
      : (boards[0]?.id ?? "")
    return {
      boards,
      effectiveSelectedBoardId,
      selectedBoard: boards.find((board) => board.id === effectiveSelectedBoardId) ?? boards[0],
    }
  },
)

export const selectOwnedBoardIds = createSelector(
  [selectAuthUserId, (state: RootState) => state],
  (userId, state): readonly string[] => userId
    ? (lobbyApi.endpoints.getUserBoardInventory.select(userId)(state).data ?? [])
    : createEmptyArray<string>(),
)

export type BoardOwnershipState = "owned" | "level-locked" | "purchasable" | "free-unlock"

export function computeBoardState(args: {
  readonly boardId: string,
  readonly unlockLevel: number,
  readonly priceGems: number,
  readonly ownedIds: ReadonlySet<string> | readonly string[],
  readonly playerLevel: number,
}): BoardOwnershipState {
  if ("has" in args.ownedIds ? args.ownedIds.has(args.boardId) : args.ownedIds.includes(args.boardId)) return "owned"
  if (args.playerLevel < args.unlockLevel) return "level-locked"
  if (args.priceGems > 0) return "purchasable"
  return "free-unlock"
}

export function todayET(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}

function isYesterdayET(dateEt: string | null, today: string): boolean {
  if (!dateEt) return false
  return new Date(today + "T00:00:00Z").getTime() - new Date(dateEt + "T00:00:00Z").getTime() === 24 * 60 * 60 * 1000
}

export function computeUpcomingDay(state: UserDailyBonusRow | null, today: string): number {
  if (state === null) return 1
  if (state.last_claim_date_et === null) return 1
  if (isYesterdayET(state.last_claim_date_et, today)) return state.current_day
  if (state.last_claim_date_et === today) return state.current_day
  return 1
}

export function computeDaysClaimedInCurrentStreak(state: UserDailyBonusRow | null, today: string): number {
  if (!state?.last_claim_date_et) return 0
  if (state.last_claim_date_et === today) return state.current_day === 1 ? 7 : state.current_day - 1
  return isYesterdayET(state.last_claim_date_et, today) ? state.current_day - 1 : 0
}

export type MissionsResult = {
  readonly state: MissionsState | null,
  readonly isLoading: boolean,
  readonly error: string | null,
}

export function nextResetMs(state: MissionsState | null): number {
  if (!state) return 0
  const dailies = state.missions.filter((mission) => mission.period === "daily")
  if (dailies.length === 0) return 0
  const earliest = Math.min(...dailies.map((mission) => new Date(mission.expires_at).getTime()))
  return Math.max(0, earliest - Date.now())
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}h ${m}m ${s}s`
}

export type {DailyBonusConfigRow as DailyBonusConfig}
