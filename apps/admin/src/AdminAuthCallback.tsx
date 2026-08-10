import {useEffect, useState} from "react"

import {useNavigate} from "react-router-dom"

import styles from "./AdminAuthCallback.module.css"
import {adminSupabase} from "./lib/adminSupabase"

/**
 * OAuth callback for the BO. Mounted at /auth/callback. The
 * adminSupabase client was constructed with `detectSessionInUrl: true`
 * + flowType 'pkce', so once this page mounts the library picks up the
 * ?code= parameter from the URL, exchanges it via the verifier sitting
 * in localStorage under `sb-admin-auth-token-code-verifier`, and writes
 * the resulting session into adminSupabase's storage. We just wait for
 * that to settle, then bounce to the Back Office root.
 *
 * Kept separate from the game's /auth/callback so the two sessions
 * never get crossed — the game's callback wouldn't have the admin
 * verifier in scope.
 */
export function AdminAuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null;
    (async () => {
      // Poll briefly: detectSessionInUrl fires once on mount, but the
      // session takes a moment to settle. We wait up to ~3s.
      for (let i = 0; i < 30; i++) {
        const {data} = await adminSupabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          navigate("/", {replace: true})
          return
        }
        await new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 100)
        })
      }
      if (cancelled) return
      setError("Could not complete sign-in. Try again, or refresh the Back Office.")
    })()
    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [navigate])

  return (<div className={styles.shell}>
    <div className={styles.inner}>
      <div className={styles.title}>
        Back Office sign-in
      </div>
      <div className={styles.status}>
        {error ?? "Finishing sign-in…"}
      </div>
      {error ? (<button
        className={styles.backButton}
        type="button"
        onClick={() => navigate("/", {replace: true})}>
        Back to Back Office
      </button>) : null}
    </div>
  </div>)
}
