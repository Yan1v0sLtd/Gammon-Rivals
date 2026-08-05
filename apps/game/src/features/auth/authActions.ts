import {createAction} from "@reduxjs/toolkit"

export const authInitializationRequested = createAction("auth/initializationRequested")
export const authGoogleSignInRequested = createAction<{readonly redirectTo?: string}>("auth/googleSignInRequested")
export const authGoogleLinkRequested = createAction<{readonly redirectTo?: string}>("auth/googleLinkRequested")
export const authAnonymousSignInRequested = createAction("auth/anonymousSignInRequested")
export const authMagicLinkRequested = createAction<{readonly email: string}>("auth/magicLinkRequested")
export const authSignOutRequested = createAction("auth/signOutRequested")
export const authOAuthCompletionRequested = createAction("auth/oauthCompletionRequested")
export const authRefreshRequested = createAction<{readonly scope: "profile" | "wallet" | "xpBoost" | "profileAndWallet"}>("auth/refreshRequested")

export type AuthCommand = "googleSignIn" | "googleLink" | "anonymousSignIn" | "magicLink" | "signOut" | "oauthCompletion"
