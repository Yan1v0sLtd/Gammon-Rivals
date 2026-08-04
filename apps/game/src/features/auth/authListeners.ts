import {isAnyOf} from "@reduxjs/toolkit"

import {isSupabaseConfigured, supabase} from "../../lib/supabase"
import {baseApi} from "../../store/baseApi"
import type {AppStartListening} from "../../store/listenerTypes"
import {playerDataApi} from "../playerData/playerDataApi"

import {authInitializationRequested, authAnonymousSignInRequested, authCommandFailed, authCommandReset, authCommandStarted, authCommandSucceeded, authGoogleLinkRequested, authGoogleSignInRequested, authMagicLinkRequested, authOAuthCompletionRequested, authRefreshRequested, authSignOutRequested} from "./authActions"
import {completeOAuthProfile, getSupabaseSession, linkGoogleIdentity, sendMagicLink, signInAnonymously, signInWithGoogle, signOut} from "./authData"
import {authInitializationStarted, authSessionResolved, authSignedOut, type AuthIdentity} from "./authSlice"

const authLifecycleMatcher = isAnyOf(authInitializationStarted, authSessionResolved, authSignedOut)

function authIdentityFromSession(session: import("@supabase/supabase-js").Session): AuthIdentity {
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    isAnonymous: session.user.is_anonymous ?? false,
  }
}

function authSessionAction(session: import("@supabase/supabase-js").Session | null) {
  if (!session?.user) return authSignedOut()
  return authSessionResolved(authIdentityFromSession(session))
}

export function startAuthListeners(startListening: AppStartListening): void {
  let initialized = false
  let authCommandSequence = 0
  // The reducer has already replaced the identity by the time this effect
  // runs, so the previous identity is tracked in the middleware closure.
  let lastAuthUserId: string | null = null
  let presenceGeneration = 0
  let activePresence: {
    readonly generation: number,
    readonly userId: string,
    readonly isAnonymous: boolean,
    readonly cleanup: () => void,
  } | null = null

  startListening({
    actionCreator: authInitializationRequested,
    effect: async (_action, {dispatch, signal}) => {
      if (initialized) return
      initialized = true
      dispatch(authInitializationStarted())
      if (!isSupabaseConfigured) {
        dispatch(authSignedOut())
        return
      }

      let authEventSeen = false
      const {data: subscription} = supabase.auth.onAuthStateChange((_event, session) => {
        authEventSeen = true
        dispatch(authSessionAction(session))
      })
      signal.addEventListener("abort", () => {
        subscription.subscription.unsubscribe()
      }, {once: true})

      try {
        const session = await getSupabaseSession()
        if (signal.aborted || authEventSeen) return
        dispatch(authSessionAction(session))
      }
      catch (err) {
        if (signal.aborted || authEventSeen) return
        console.error("Failed to restore the Supabase session:", err)
        dispatch(authSignedOut())
      }
    },
  })

  const commandMatcher = isAnyOf(authGoogleSignInRequested, authGoogleLinkRequested, authAnonymousSignInRequested, authMagicLinkRequested, authSignOutRequested, authOAuthCompletionRequested, authCommandReset)
  startListening({
    matcher: commandMatcher,
    effect: async (action, {cancelActiveListeners, dispatch, getState, signal}) => {
      cancelActiveListeners()
      const sequence = ++authCommandSequence
      const isCurrent = (): boolean => !signal.aborted && sequence === authCommandSequence
      if (authCommandReset.match(action)) return
      const command = authGoogleSignInRequested.match(action) ? "googleSignIn" : authGoogleLinkRequested.match(action) ? "googleLink" : authAnonymousSignInRequested.match(action) ? "anonymousSignIn" : authMagicLinkRequested.match(action) ? "magicLink" : authSignOutRequested.match(action) ? "signOut" : "oauthCompletion"
      dispatch(authCommandStarted({command}))
      try {
        if (authOAuthCompletionRequested.match(action)) {
          const session = await getSupabaseSession()
          if (!session?.user) throw new Error("Google sign-in did not return a session. Please try again.")
          dispatch(authSessionResolved(authIdentityFromSession(session)))
          const profile = await completeOAuthProfile(session.user)
          if (!isCurrent()) return
          if (getState().auth.userId === session.user.id) {
            await dispatch(playerDataApi.util.upsertQueryData("getProfile", session.user.id, profile))
            if (isCurrent() && getState().auth.userId === session.user.id) {
              await dispatch(playerDataApi.endpoints.getWallet.initiate(session.user.id, {
                subscribe: false,
                forceRefetch: true,
              }))
            }
          }
          if (!isCurrent()) return
          const currentAuth = getState().auth
          if (currentAuth.userId === session.user.id && currentAuth.command.name === command && currentAuth.command.status === "pending") {
            dispatch(authCommandSucceeded({command}))
          }
        }
        else if (authGoogleSignInRequested.match(action)) await signInWithGoogle(action.payload.redirectTo)
        else if (authGoogleLinkRequested.match(action)) await linkGoogleIdentity(action.payload.redirectTo)
        else if (authAnonymousSignInRequested.match(action)) await signInAnonymously()
        else if (authMagicLinkRequested.match(action)) await sendMagicLink(action.payload.email)
        else await signOut()
        if (isCurrent() && !authOAuthCompletionRequested.match(action)) dispatch(authCommandSucceeded({command}))
      }
      catch (err) {
        if (!isCurrent()) return
        dispatch(authCommandFailed({command, error: err instanceof Error ? err.message : String(err)}))
      }
    },
  })

  startListening({
    actionCreator: authRefreshRequested,
    effect: (action, {dispatch, getState}) => {
      const userId = getState().auth.userId
      if (!userId) return
      if (action.payload.scope === "profile" || action.payload.scope === "profileAndWallet") {
        dispatch(baseApi.util.invalidateTags([{type: "Profile", id: userId}]))
      }
      if (action.payload.scope === "wallet" || action.payload.scope === "profileAndWallet") {
        dispatch(baseApi.util.invalidateTags([{type: "Wallet", id: userId}]))
      }
      if (action.payload.scope === "xpBoost" || action.payload.scope === "profileAndWallet") {
        dispatch(baseApi.util.invalidateTags([{type: "XpBoost", id: userId}]))
      }
    },
  })

  const cleanupPresence = (): void => {
    presenceGeneration += 1
    const presence = activePresence
    activePresence = null
    presence?.cleanup()
  }

  startListening({
    matcher: authLifecycleMatcher,
    effect: (action, {
      getState,
      dispatch,
    }) => {
      const userId = getState().auth.userId
      if (userId !== lastAuthUserId) {
        if (lastAuthUserId !== null) {
          dispatch(baseApi.util.resetApiState())
        }
        lastAuthUserId = userId
      }
      else if (!authSessionResolved.match(action)) {
        cleanupPresence()
        return
      }

      if (!authSessionResolved.match(action)) {
        cleanupPresence()
        return
      }

      const {userId: resolvedUserId, isAnonymous} = action.payload
      if (
        activePresence?.userId === resolvedUserId
        && activePresence.isAnonymous === isAnonymous
      ) return

      cleanupPresence()
      if (!isSupabaseConfigured) return

      const generation = ++presenceGeneration
      const channel = supabase.channel("online-users", {
        config: {
          presence: {
            key: resolvedUserId,
          },
        },
      })
      let cleanedUp = false
      const cleanup = (): void => {
        if (cleanedUp) return
        cleanedUp = true
        void channel.untrack()
        void supabase.removeChannel(channel)
      }
      activePresence = {generation, userId: resolvedUserId, isAnonymous, cleanup}

      channel
        .on("presence", {event: "sync"}, () => {
          // Trackers do not consume sync events; the admin watcher does.
        })
        .subscribe((status) => {
          void (async () => {
            if (status !== "SUBSCRIBED") return
            if (activePresence?.generation !== generation) return
            await channel.track({
              profile_id: resolvedUserId,
              is_guest: isAnonymous,
              joined_at: Date.now(),
            })
            if (activePresence?.generation !== generation) cleanup()
          })()
        })
    },
  })

  startListening({
    matcher: playerDataApi.endpoints.getProfile.matchFulfilled,
    effect: (action, {
      getState,
      dispatch,
    }) => {
      const currentUserId = getState().auth.userId
      if (currentUserId === null || action.meta.arg.originalArgs !== currentUserId) return
      if (!action.payload?.deleted_at) return
      dispatch(authSignedOut())
      void supabase.auth.signOut().catch((err: unknown) => {
        console.error("Supabase sign-out failed after account deletion:", err)
      })
    },
  })
}
