import type {PayloadAction} from "@reduxjs/toolkit"
import {createSlice} from "@reduxjs/toolkit"

import {authCommandFailed, authCommandReset, authCommandStarted, authCommandSucceeded, type AuthCommand} from "./authActions"

export type AuthStatus = "initializing" | "authenticated" | "signedOut"

/**
 * Serializable view of the Supabase session. Supabase stays the token
 * authority; this slice mirrors only the minimal identity the selectors
 * need and never stores a Session/User object or server row.
 */
export type AuthState = {
  readonly status: AuthStatus,
  readonly userId: string | null,
  readonly email: string | null,
  readonly isAnonymous: boolean,
  readonly command: {readonly name: AuthCommand | null, readonly status: "idle" | "pending" | "succeeded" | "failed", readonly error: string | null},
}

/** Normalized identity projection passed by authSessionResolved. */
export type AuthIdentity = {
  readonly userId: string,
  readonly email: string | null,
  readonly isAnonymous: boolean,
}

export function createInitialAuthState(): AuthState {
  return {
    status: "initializing",
    userId: null,
    email: null,
    isAnonymous: false,
    command: {name: null, status: "idle", error: null},
  }
}

function createSignedOutAuthState(): AuthState {
  return {
    status: "signedOut",
    userId: null,
    email: null,
    isAnonymous: false,
    command: {name: null, status: "idle", error: null},
  }
}

export const authSlice = createSlice({
  name: "auth",
  initialState: createInitialAuthState(),
  reducers: {
    authInitializationStarted: () => createInitialAuthState(),
    authSessionResolved(state, action: PayloadAction<AuthIdentity>) {
      state.status = "authenticated"
      state.userId = action.payload.userId
      state.email = action.payload.email
      state.isAnonymous = action.payload.isAnonymous
    },
    authSignedOut: () => createSignedOutAuthState(),
  },
  extraReducers: (builder) => {
    builder
      .addCase(authCommandStarted, (state, action) => {
        state.command = {name: action.payload.command, status: "pending", error: null}
      })
      .addCase(authCommandSucceeded, (state, action) => {
        state.command = {name: action.payload.command, status: "succeeded", error: null}
      })
      .addCase(authCommandFailed, (state, action) => {
        state.command = {name: action.payload.command, status: "failed", error: action.payload.error}
      })
      .addCase(authCommandReset, (state) => {
        state.command = {name: null, status: "idle", error: null}
      })
  },
})

export const authSliceActions = authSlice.actions

export const authReducer = authSlice.reducer
