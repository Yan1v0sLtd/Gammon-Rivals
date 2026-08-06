import {useEffect, useState} from "react"

import {Link, useNavigate} from "react-router-dom"

import {useAppDispatch, useAppSelector} from "../../store/hooks"
import {authSignOutRequested} from "../auth/authActions"
import {selectAuthCommand} from "../auth/authSelectors"

import styles from "./ProfileAccountActions.module.css"

export function ProfileAccountActions() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const authCommand = useAppSelector(selectAuthCommand)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    if (authCommand.name === "signOut" && authCommand.status !== "pending") {
      setSigningOut(false)
      if (authCommand.status === "failed") setSignOutError(authCommand.error ?? "Could not log out.")
      if (authCommand.status === "succeeded") navigate("/play")
    }
  }, [authCommand, navigate])

  const handleSignOut = () => {
    setSigningOut(true)
    setSignOutError(null)
    dispatch(authSignOutRequested())
  }

  return (<>
    {/* Full-width pill that fills the left column so it visually
        * matches the cards above. */}
    <button
      className={styles.profileLogoutButton}
      disabled={signingOut}
      type="button"
      onClick={() => {
        handleSignOut()
      }}>
      <span
        aria-hidden="true"
        className={styles.profileLogoutIcon}/>
      {signingOut ? "Logging out..." : "Log Out"}
    </button>
    {signOutError && <div className={styles.profileSaveProgressErr}>{signOutError}</div>}

    {/* Account deletion (Google Play requirement + privacy commitment).
          Links to the public /delete-account page, which handles the
          confirm + delete flow. */}
    <Link
      className={styles.profileDeleteLink}
      to="/delete-account">
      Delete account
    </Link>
  </>)
}
