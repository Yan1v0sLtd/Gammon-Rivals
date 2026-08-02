import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export type AuthStatus = 'initializing' | 'authenticated' | 'signedOut';

/**
 * Serializable view of the Supabase session. Supabase stays the token
 * authority; this slice mirrors only the minimal identity the selectors
 * need and never stores a Session/User object or server row.
 */
export interface AuthState {
  readonly status: AuthStatus;
  readonly userId: string | null;
  readonly email: string | null;
  readonly isAnonymous: boolean;
}

/** Normalized identity projection passed by authSessionResolved. */
export interface AuthIdentity {
  readonly userId: string;
  readonly email: string | null;
  readonly isAnonymous: boolean;
}

export function createInitialAuthState(): AuthState {
  return { status: 'initializing', userId: null, email: null, isAnonymous: false };
}

function createSignedOutAuthState(): AuthState {
  return { status: 'signedOut', userId: null, email: null, isAnonymous: false };
}

export const authSlice = createSlice({
  name: 'auth',
  initialState: createInitialAuthState(),
  reducers: {
    authInitializationStarted: () => createInitialAuthState(),
    authSessionResolved(state, action: PayloadAction<AuthIdentity>) {
      state.status = 'authenticated';
      state.userId = action.payload.userId;
      state.email = action.payload.email;
      state.isAnonymous = action.payload.isAnonymous;
    },
    authSignedOut: () => createSignedOutAuthState(),
  },
});

export const { authInitializationStarted, authSessionResolved, authSignedOut } =
  authSlice.actions;

export default authSlice.reducer;
