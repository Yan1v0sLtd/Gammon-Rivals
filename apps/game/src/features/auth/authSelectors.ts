import {createSelector} from "@reduxjs/toolkit"

import type {ProfileProgression} from "../../../../../packages/shared/src/progression"
import {getProfileProgression} from "../../../../../packages/shared/src/progression"
import {createEmptyArray} from "../../lib/constants"
import type {RootState} from "../../store/store"
import type {LevelConfig, LevelStatusTier} from "../playerData/playerData"
import {playerDataApi} from "../playerData/playerDataApi"

import type {AuthState} from "./authSlice"

/** Slice-of-root-state shape the auth selectors read from; `api` is the
 *  RTK Query cache the player-data selectors derive from. */
export type AuthRootState = {
  readonly auth: AuthState,
}

export const selectAuthInitializing = (state: AuthRootState) => state.auth.status === "initializing"
export const selectAuthUserId = (state: AuthRootState) => state.auth.userId
export const selectAuthEmail = (state: AuthRootState) => state.auth.email
export const selectIsAnonymous = (state: AuthRootState) => state.auth.isAnonymous
export const selectAuthCommand = (state: AuthRootState) => state.auth.command

// User-scoped rows are keyed by the current auth user ID; signed-out
// (or not-yet-resolved) identity short-circuits to null so no query is
// constructed for an empty user ID.

export const selectCurrentProfile = createSelector([selectAuthUserId, (state: RootState) => state], (userId, state) => userId ? (playerDataApi.endpoints.getProfile.select(userId)(state).data ?? null) : null)

export const selectCurrentWallet = createSelector([selectAuthUserId, (state: RootState) => state], (userId, state) => userId ? (playerDataApi.endpoints.getWallet.select(userId)(state).data ?? null) : null)

export const selectActiveXpBoost = createSelector([selectAuthUserId, (state: RootState) => state], (userId, state) => userId ? (playerDataApi.endpoints.getActiveXpBoost.select(userId)(state).data ?? null) : null)

// Level configs and status tiers are global (not user-scoped) rows, so
// they are read from the cache regardless of identity.

export const selectLevelConfigs = createSelector([(state: RootState) => state], (state): readonly LevelConfig[] => playerDataApi.endpoints.getLevelConfigs.select(undefined)(state).data ?? createEmptyArray<LevelConfig>())

export const selectLevelStatusTiers = createSelector([(state: RootState) => state], (state): readonly LevelStatusTier[] => playerDataApi.endpoints.getLevelStatusTiers.select(undefined)(state).data ?? createEmptyArray<LevelStatusTier>())

export const selectIsGuest = createSelector([selectCurrentProfile, selectIsAnonymous], (profile, isAnonymous) => profile?.is_guest ?? isAnonymous)

export const selectProfileProgression = createSelector([selectCurrentProfile, selectLevelConfigs, selectLevelStatusTiers], (profile, levelConfigs, levelStatusTiers): ProfileProgression => getProfileProgression(profile, levelConfigs, levelStatusTiers))
