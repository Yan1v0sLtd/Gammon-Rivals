import {useEffect, useState} from "react"

import {useAppDispatch, useAppSelector} from "../../store/hooks"
import {authGoogleLinkRequested} from "../auth/authActions"
import {selectAuthCommand, selectIsGuest} from "../auth/authSelectors"

import styles from "./ProfileSaveProgress.module.css"

export function ProfileSaveProgress() {
  const dispatch = useAppDispatch()
  const isGuest = useAppSelector(selectIsGuest)
  const authCommand = useAppSelector(selectAuthCommand)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [linkErr, setLinkErr] = useState<string | null>(null)

  useEffect(() => {
    if (authCommand.name === "googleLink") {
      if (authCommand.status === "failed") setLinkErr(authCommand.error ?? "Google linking failed.")
      if (authCommand.status !== "pending") setLinkingGoogle(false)
    }
  }, [authCommand])

  // Reset the "Opening Google..." button state when the user returns to
  // the app. handleLinkGoogle sets linkingGoogle=true and kicks off the
  // OAuth flow; on a successful link the app redirects through
  // /auth/callback and this component remounts fresh. But if the user
  // opens the Google sheet and then CANCELS (no redirect fires), the
  // promise resolves without throwing and linkingGoogle would stick on
  // true forever — leaving the button stuck on "Opening Google..." and
  // disabled. Whenever the page becomes visible/focused again, clear it
  // so the button is clickable again. (If the link actually succeeded,
  // auth state refreshes, isGuest flips false, and the button is gone.)
  useEffect(() => {
    const reset = () => {
      if (document.visibilityState === "visible") setLinkingGoogle(false)
    }
    document.addEventListener("visibilitychange", reset)
    window.addEventListener("focus", reset)
    return () => {
      document.removeEventListener("visibilitychange", reset)
      window.removeEventListener("focus", reset)
    }
  }, [])

  const handleLinkGoogle = () => {
    setLinkErr(null)
    setLinkingGoogle(true)
    dispatch(authGoogleLinkRequested({
      redirectTo: `${window.location.origin}/auth/callback?next=/profile`,
    }))
  }

  if (!isGuest) return null

  return (<div className={styles.profileSaveProgress}>
    <button
      className={styles.profileGoogleButton}
      disabled={linkingGoogle}
      type="button"
      onClick={() => {
        handleLinkGoogle()
      }}>
      <span
        aria-hidden="true"
        className={styles.profileGoogleGlyph}>G</span>
      {linkingGoogle ? "Opening Google..." : "Connect with Google"}
    </button>
    {linkErr && <span className={styles.profileSaveProgressErr}>{linkErr}</span>}
  </div>)
}
