import {useEffect, useRef, useState} from "react"

import {Link, useLocation, useNavigate, useSearchParams} from "react-router-dom"

import {authOAuthCompletionRequested} from "../features/auth/authActions"
import {selectAuthCommand} from "../features/auth/authSelectors"
import {authSliceActions} from "../features/auth/authSlice"
import {supabase} from "../lib/supabase"
import {useAppDispatch, useAppSelector} from "../store/hooks"

/**
 * The post-sign-in landing path. Defaults to `/play` (the lobby)
 * — not `/` (the public marketing landing). A signed-in player
 * should always end up inside the game, not back on the home
 * page they just clicked through. Same fallback applies when
 * the `next` param is unsafe (off-origin, recursive callback,
 * etc.) so a misbehaving link can't loop the user through the
 * callback forever.
 */
const POST_SIGN_IN_DEFAULT = "/play"

function safeNextPath(value: string | null): string {
  if (!value) return POST_SIGN_IN_DEFAULT
  if (!value.startsWith("/") || value.startsWith("//")) return POST_SIGN_IN_DEFAULT
  if (value.startsWith("/auth/callback")) return POST_SIGN_IN_DEFAULT
  return value
}

function readCallbackParam(params: URLSearchParams, key: string): string | null {
  const fromSearch = params.get(key)
  if (fromSearch) return fromSearch
  if (typeof window === "undefined" || !window.location.hash) return null
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  return hashParams.get(key)
}

function formatAuthError(message: string): string {
  if (message.toLowerCase().includes("pkce code verifier not found")) {
    return ["The Google sign-in started in one browser context, but the callback opened without the temporary login token.", "Go back to the lobby and start Google sign-in again from the same tab. If you opened the app with localhost, use 127.0.0.1 instead."].join(" ")
  }

  if (message.toLowerCase().includes("unable to exchange external code")) {
    return ["Google reached Supabase, but Supabase could not exchange the Google login code.", "Check that the Google OAuth Client ID and Client Secret saved in Supabase are from the same Web application client, and that Google Cloud allows the Supabase callback URL."].join(" ")
  }
  return message
}

export function AuthCallback() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const dispatch = useAppDispatch()
  const authCommand = useAppSelector(selectAuthCommand)
  const [error, setError] = useState<string | null>(null)
  const completionRef = useRef<Promise<void> | null>(null)
  const completionRequestedRef = useRef(false)
  const completionKeyRef = useRef<string | null>(null)
  const callbackKey = `${location.pathname}${location.search}${location.hash}`

  useEffect(() => {
    let cancelled = false
    if (completionKeyRef.current !== callbackKey) {
      completionKeyRef.current = callbackKey
      completionRef.current = null
      completionRequestedRef.current = false
      setError(null)
      dispatch(authSliceActions.authCommandReset())
    }
    completionRef.current ??= (async () => {
      const authError = readCallbackParam(params, "error_description") ?? readCallbackParam(params, "error")
      if (authError) throw new Error(authError)

      const code = readCallbackParam(params, "code")
      if (code) {
        const {error: exchangeError} = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) throw exchangeError
      }
      else {
        const {
          data,
          error: sessionError,
        } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) {
          throw new Error("Google sign-in did not return a session. Please try again.")
        }
      }
      if (completionKeyRef.current !== callbackKey) return
      completionRequestedRef.current = true
      dispatch(authOAuthCompletionRequested())
    })()

    void completionRef.current?.catch((err: unknown) => {
      if (!cancelled) setError(formatAuthError(err instanceof Error ? err.message : String(err)))
    })

    return () => {
      cancelled = true
    }
  }, [callbackKey, dispatch, navigate, params])

  useEffect(() => {
    if (!completionRequestedRef.current) return
    if (authCommand.name !== "oauthCompletion") return
    if (authCommand.status === "succeeded") navigate(safeNextPath(readCallbackParam(params, "next")), {replace: true})
    if (authCommand.status === "failed") setError(formatAuthError(authCommand.error ?? "Sign-in could not be completed."))
  }, [authCommand, navigate, params])

  if (!error) {
    return (<main
      aria-label="Completing sign-in"
      className="min-h-dvh bg-[#071120]"/>)
  }

  return (<main className="grid min-h-dvh place-items-center bg-[#071120] px-4 text-white">
    <section
      className="w-full max-w-md rounded-2xl border border-white/12 bg-[#101a2a]/88 p-6 text-center shadow-2xl">
      <div className="font-display text-xs font-black uppercase tracking-[0.42em] text-[#f6d770]">
        Gammon Rivals
      </div>
      <h1 className="mt-4 font-display text-2xl font-black text-white">
        Sign-in needs attention
      </h1>
      <p className="mt-3 text-sm text-rose-100">{error}</p>
      <Link
        className="mt-5 inline-block rounded-lg bg-[#f6d770] px-4 py-2 font-black text-[#101a2a]"
        to="/play">
        Back to lobby
      </Link>
    </section>
  </main>)
}
