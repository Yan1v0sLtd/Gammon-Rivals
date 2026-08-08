import {useState} from "react"

import {Link} from "react-router-dom"

import {authSignOutRequested} from "../features/auth/authActions"
import {useDeleteMyAccountMutation} from "../features/auth/authApi"
import {selectAuthUserId, selectAuthEmail, selectCurrentProfile, selectAuthInitializing} from "../features/auth/authSelectors"
import {useAppDispatch, useAppSelector} from "../store/hooks"

import styles from "./DeleteAccount.module.css"

// Public, ungated page (see App.tsx routing). It serves two purposes:
//  1. The in-app account-deletion flow (linked from Profile).
//  2. The publicly reachable account-deletion URL required by Google Play
//     for apps that allow account creation (works without signing in:
//     shows instructions + a support contact).
// All deletion goes through the delete_my_account RPC (self-scoped, cascades
// to every player_*/user_* table). Irreversible.

// TODO: confirm the public support address before launch.
const SUPPORT_EMAIL = "support@gammonrivals.com"

const DELETED_ITEMS = ["Your account and sign-in (guest or Google)", "Your profile, display name, level, XP, and rating", "Your Coins and Gems balances and in-game transaction history", "Your match history, missions, bonuses, and unlocked boards"]

export function DeleteAccount() {
  const dispatch = useAppDispatch()
  const userId = useAppSelector(selectAuthUserId)
  const email = useAppSelector(selectAuthEmail)
  const profile = useAppSelector(selectCurrentProfile)
  const isLoading = useAppSelector(selectAuthInitializing)
  const [deleteMyAccount] = useDeleteMyAccountMutation()
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const signedIn = !!userId
  const canDelete = confirmText.trim().toUpperCase() === "DELETE"

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await deleteMyAccount().unwrap()
      // The account + its JWT are gone server-side; clear the local session
      // too (best-effort — the token may already be invalid).
      try {
        dispatch(authSignOutRequested())
      }
      catch {
        /* session already invalid — fine */
      }
      setDone(true)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string" ? err.message : String(err)))
      setDeleting(false)
    }
  }

  return (<div className={styles.page}>
    <div className={styles.card}>
      <h1 className={styles.title}>Delete your Gammon Rivals account</h1>

      {done ? (<div className={styles.doneSection}>
        <div className={styles.successBox}>
          Your account and all associated data have been permanently deleted.
        </div>
        <p className={styles.doneText}>
          Thanks for playing. You can start fresh any time.
        </p>
        <Link
          className={styles.amberButton}
          to="/play">
          Back to Gammon Rivals
        </Link>
      </div>) : (<>
        <p className={styles.intro}>
          Deleting your account is <strong className={styles.strong}>permanent and cannot be
            undone</strong>. It immediately removes:
        </p>
        <ul className={styles.list}>
          {DELETED_ITEMS.map((item) => (<li
            key={item}
            className={styles.listItem}>
            <span
              aria-hidden="true"
              className={styles.bullet}>•</span>
            <span>{item}</span>
          </li>))}
        </ul>
        <p className={styles.note}>
          Deletion does not refund prior purchases. Purchase records held by the Apple App
          Store or Google Play are managed by those stores under their own terms.
        </p>

        {isLoading ? (<div className={styles.loading}>Checking your session…</div>) : signedIn ? (
          <div className={styles.signedInSection}>
            <div className={styles.signedInText}>
              Signed in as{" "}
              <strong className={styles.strong}>
                {profile?.display_name ?? email ?? "your account"}
              </strong>
              .
            </div>
            <label className={styles.label}>
              Type <span className={styles.labelHighlight}>DELETE</span> to confirm
              <input
                autoCapitalize="characters"
                autoComplete="off"
                className={styles.input}
                placeholder="DELETE"
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value)
                }}/>
            </label>
            {error && (
              <div className={styles.errorBox}>
                {error}
              </div>)}
            <button
              className={styles.deleteButton}
              disabled={!canDelete || deleting}
              type="button"
              onClick={() => void handleDelete()}>
              {deleting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <Link
              className={styles.cancelLink}
              to="/profile">
              Cancel
            </Link>
          </div>) : (<div className={styles.signedOutSection}>
          <p>To delete your account, choose either option:</p>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepLabel}>In the app:</span> open Gammon Rivals →{" "}
              <span className={styles.stepValue}>Profile</span> →{" "}
              <span className={styles.stepValue}>Delete account</span>.
            </li>
            <li>
              <span className={styles.stepLabel}>By email:</span> write to{" "}
              <a
                className={styles.emailLink}
                href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              from the email address on your account, and we will delete your account and
              data within 30 days.
            </li>
          </ol>
          <Link
            className={styles.amberButton}
            to="/play">
            Open the app
          </Link>
        </div>)}

        <p className={styles.footer}>
          Questions about deletion or your data? Contact{" "}
          <a
            className={styles.footerLink}
            href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </>)}
    </div>
  </div>)
}
