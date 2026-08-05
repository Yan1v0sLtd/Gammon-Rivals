import {useEffect, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query/react"
import {Link, useNavigate} from "react-router-dom"

import {Avatar} from "../components/Avatar"
import {useShop} from "../features/appUi/useShop"
import {authGoogleLinkRequested, authSignOutRequested} from "../features/auth/authActions"
import {selectAuthCommand, selectAuthUserId, selectCurrentProfile, selectCurrentWallet, selectProfileProgression, selectIsGuest, selectAuthInitializing} from "../features/auth/authSelectors"
import type {MatchSummary} from "../features/playerData/matchHistoryData"
import {
  useGetMatchHistoryQuery,
  useGetOwnerStatsQuery,
  useLazyGetGamesForMatchQuery,
  useUpdateDisplayNameMutation,
} from "../features/playerData/playerDataApi"
import {formatCompactNumber} from "../lib/format"
import {useAppDispatch, useAppSelector} from "../store/hooks"

import styles from "./Profile.module.css"

const MODE_LABEL: Record<string, string> = {
  hotseat: "Hot-seat",
  "ai-easy": "AI - Easy",
  "ai-medium": "AI - Medium",
  "ai-hard": "AI - Hard",
}

// Friends + Settings shortcuts removed from the Profile top bar
// (operator preference — those entry points live elsewhere).

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    return String((err).message)
  }
  return String(err)
}

function ownerOutcome(m: MatchSummary): "won" | "lost" | "open" | "hotseat" {
  if (!m.finished_at) return "open"
  if (m.mode === "hotseat") return "hotseat"
  return m.winner === "white" ? "won" : "lost"
}

function modeIcon(mode: string): "hotseat" | "online" | "ai" {
  if (mode === "hotseat") return "hotseat"
  if (mode.startsWith("ai-")) return "ai"
  return "online"
}

const MATCH_ICON_CLASS: Record<ReturnType<typeof modeIcon>, string> = {
  hotseat: styles.profileMatchIconHotseat,
  online: styles.profileMatchIconOnline,
  ai: styles.profileMatchIconAi,
}

const HISTORY_OUTCOME_CLASS: Record<ReturnType<typeof ownerOutcome>, string> = {
  won: styles.profileHistoryStatusWon,
  lost: styles.profileHistoryStatusLost,
  open: styles.profileHistoryStatusOpen,
  hotseat: styles.profileHistoryStatusHotseat,
}

type StatIcon = "coins" | "gems" | "finished" | "wins" | "losses" | "hotseat"

const STAT_ICON_CLASS: Record<StatIcon, string> = {
  coins: styles.profileStatIconCoins,
  gems: styles.profileStatIconGems,
  finished: styles.profileStatIconFinished,
  wins: styles.profileStatIconWins,
  losses: styles.profileStatIconLosses,
  hotseat: styles.profileStatIconHotseat,
}

export function Profile() {
  const dispatch = useAppDispatch()
  const userId = useAppSelector(selectAuthUserId)
  const authCommand = useAppSelector(selectAuthCommand)
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)
  const isLoading = useAppSelector(selectAuthInitializing)
  const isGuest = useAppSelector(selectIsGuest)
  const [updateDisplayName] = useUpdateDisplayNameMutation()
  const navigate = useNavigate()
  const {openShop} = useShop()
  const {data: stats} = useGetOwnerStatsQuery(userId ?? skipToken)
  const [getGamesForMatch] = useLazyGetGamesForMatchQuery()
  const {
    data: matches,
    error: historyError,
  } = useGetMatchHistoryQuery(userId ?? skipToken)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    if (authCommand.name === "googleLink") {
      if (authCommand.status === "failed") setLinkErr(authCommand.error ?? "Google linking failed.")
      if (authCommand.status !== "pending") setLinkingGoogle(false)
    }
    if (authCommand.name === "signOut" && authCommand.status !== "pending") {
      setSigningOut(false)
      if (authCommand.status === "failed") setSignOutError(authCommand.error ?? "Could not log out.")
      if (authCommand.status === "succeeded") navigate("/play")
    }
  }, [authCommand, navigate])

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

  const startEditName = () => {
    setDraftName(profile?.display_name ?? "")
    setEditing(true)
  }

  const saveName = async () => {
    setSavingName(true)
    try {
      if (!userId) return
      await updateDisplayName({userId, name: draftName}).unwrap()
      setEditing(false)
    }
    catch (err) {
      console.warn("saveName failed", err)
    }
    finally {
      setSavingName(false)
    }
  }

  const handleLinkGoogle = () => {
    setLinkErr(null)
    setLinkingGoogle(true)
    dispatch(authGoogleLinkRequested({
      redirectTo: `${window.location.origin}/auth/callback?next=/profile`,
    }))
  }

  const handleSignOut = () => {
    setSigningOut(true)
    setSignOutError(null)
    dispatch(authSignOutRequested())
  }

  const openReplay = async (matchId: string) => {
    try {
      const result = await getGamesForMatch(matchId)
      if (result.error) {
        console.warn("open replay failed", result.error)
        return
      }
      const finished = (result.data ?? []).filter((g) => g.finished_at)
      if (finished.length === 0) return
      navigate(`/replay/${finished[0].id}`)
    }
    catch (err) {
      console.warn("open replay failed", err)
    }
  }

  if (isLoading) {
    return (<main className={`${styles.profilePage} ${styles.profilePageLoading}`}>
      <div className={styles.profileLoadingText}>
        Loading
      </div>
    </main>)
  }

  // Canonical per-level label from getProfileProgression — same source the lobby
  // card uses, so the two XP bars can't drift (was cumulative xp/target here).
  const xpText = progression.xpBarLabel
  const nextLevelLabel = progression.nextLevelXp ? progression.level + 1 : progression.level
  // Show ALL match history rows (was capped at 3). The list
  // scrolls when > 4 entries thanks to the max-h + overflow-y-auto
  // wrapper applied around .profile-history-list in the JSX below.
  const visibleMatches = matches ?? null

  return (<main className={styles.profilePage}>
    <div className={styles.profileScreen}>
      <header className={styles.profileTopNav}>
        <Link
          aria-label="Back to lobby"
          className={styles.profileIconButton}
          to="/play">
          <span className={styles.profileBackChevron}/>
        </Link>

        {/* Wallet pills centered in the top nav (was right-aligned).
            * Same pill design as the lobby top-bar, but the size-modifier
            * class shrinks the pill ~20 % so the centered cluster sits
            * comfortably in the available room without crowding the
            * back button. */}
        <div
          aria-label="Wallet"
          className={styles.profileTopCurrency}>
          <CurrencyPill
            flyTarget="coins"
            icon="/lobby/icons/gold-coin.webp"
            label="Coins"
            value={wallet?.coins ?? 0}
            onAdd={openShop}/>
          <CurrencyPill
            flyTarget="gems"
            icon="/lobby/icons/gem.webp"
            label="Gems"
            value={wallet?.gems ?? 0}
            onAdd={openShop}/>
        </div>
      </header>

      {/* Two-column body: profile + stats + logout on the left,
          * match history (tall) on the right so the player can scan
          * more matches without scrolling. */}
      <div className={styles.profileBodyGrid}>
        <div className={styles.profileLeftStack}>
          <section className={styles.profileMainCard}>
            <div className={styles.profileAvatarStage}>
              <div className={styles.profileAvatarGlow}/>
              <Avatar
                className={styles.profileAvatarImage}
                imageUrl={profile?.avatar_url}
                ring="none"
                seed={profile?.avatar_seed ?? "profile"}
                size={220}/>
              {/* Same rounded shield shape as the lobby profile card
                  * (.lobby-pp-shield), scaled up + anchored to the
                  * bottom-centre of the avatar circle via .profile-pp-shield. */}
              <div className={styles.profilePpShield}>
                <span>{progression.level}</span>
              </div>
            </div>

            <div className={styles.profileInfoColumn}>
              {editing ? (<div className={styles.profileNameEditor}>
                <input
                  autoFocus
                  className={styles.profileNameInput}
                  maxLength={32}
                  value={draftName}
                  onChange={(e) => {
                    setDraftName(e.target.value)
                  }}/>
                <button
                  className={styles.profileSmallAction}
                  disabled={savingName || draftName.trim().length === 0}
                  type="button"
                  onClick={() => void saveName()}>
                  Save
                </button>
                <button
                  className={`${styles.profileSmallAction} ${styles.profileSmallActionGhost}`}
                  type="button"
                  onClick={() => {
                    setEditing(false)
                  }}>
                  Cancel
                </button>
              </div>) : (<div className={styles.profileNameRow}>
                <h1>{profile?.display_name ?? "Player"}</h1>
                <button
                  aria-label="Edit name"
                  className={styles.profileEditButton}
                  type="button"
                  onClick={startEditName}>
                  <span/>
                </button>
              </div>)}

              <div className={styles.profileRankRow}>
                <span className={styles.profileRankBadge}>
                  <span
                    aria-hidden="true"
                    className={styles.profileRankShield}>
                    <span/>
                  </span>
                  <span>{progression.statusLabel}</span>
                </span>
                <span className={styles.profileRating}>
                  <span
                    aria-hidden="true"
                    className={styles.profileRatingCup}/>
                  Rating <strong>{formatCompactNumber(profile?.rating ?? 1500)}</strong>
                </span>
              </div>

              <div className={styles.profileXpSection}>
                <div className={styles.profileLevelRow}>
                  <span>Level {progression.level}</span>
                  <span>Level {nextLevelLabel}</span>
                </div>
                {/* Lobby lava-XP bar — reuses the .lobby-profile-progress
                    * class (orange→yellow gradient with animated bubble
                    * layers riding the filled portion). profile-xp-wide
                    * scope widens it to the profile card's column. */}
                <div className={styles.profileXpRow}>
                  <span
                    aria-label={`XP progress ${progression.progressLabel}`}
                    className={`lobby-profile-progress ${styles.profileXpWide}`}>
                    <span
                      className="lobby-profile-progress-fill"
                      style={{width: `${progression.progressPercent}%`}}>
                      <span
                        aria-hidden="true"
                        className="lobby-profile-progress-bubbles"/>
                    </span>
                    <span className="lobby-profile-progress-label">{xpText}</span>
                  </span>
                </div>
                <div className={styles.profileNextReward}>
                  <span>Next Reward:</span>
                  <img
                    alt=""
                    draggable={false}
                    src="/lobby/icons/gold-coin.webp"/>
                  <strong>500 Coins</strong>
                </div>
              </div>
            </div>
          </section>

          {/* Guest-only "save your progress" CTA. Moved OUT of the
              * profile card's info column (where it was crammed under the
              * XP bar and read as an afterthought) to a dedicated
              * full-width banner directly below the card — a clear,
              * uncramped call to action. Absent entirely for signed-in
              * users, so their stack stays card -> stats -> logout. */}
          {isGuest && (<div className={styles.profileSaveProgress}>
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
          </div>)}

          {/* Stats live UNDER the avatar/info card (was on the right).
              * Wallet balances are no longer duplicated here — the top
              * bar already shows them. Four match-stats only. */}
          <section
            aria-label="Player stats"
            className={styles.profileStatGrid}>
            <Stat
              icon="finished"
              label="Finished"
              value={stats?.totalFinished ?? 0}/>
            <Stat
              icon="wins"
              label="AI Wins"
              value={stats?.aiWins ?? 0}/>
            <Stat
              icon="losses"
              label="AI Losses"
              value={stats?.aiLosses ?? 0}/>
            <Stat
              icon="hotseat"
              label="Hot-seat"
              value={stats?.hotseatPlayed ?? 0}/>
          </section>

          {/* Full-width pill that fills the left column so it visually
              * matches the cards above. Reshaped from the prior square
              * 1×1 button. */}
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
        </div>

        <section className={styles.profileHistoryPanel}>
          <h2>Match History</h2>
          {historyError && (<div className={`${styles.profilePanelMessage} ${styles.profilePanelMessageError}`}>
            {errorMessage(historyError)}
          </div>)}
          {visibleMatches === null ? (
            <div className={styles.profilePanelMessage}>Loading...</div>) : visibleMatches.length === 0 ? (
            <div className={styles.profilePanelMessage}>
              <span>No matches yet.</span>
              <Link to="/play">Start one</Link>
            </div>) : (// History panel is the full height of the right column now,
            // so the inner scroll container takes 100 % and shows ~10
            // rows on a typical landscape viewport.
            <div className={styles.profileHistoryScroll}>
              <ul className={styles.profileHistoryList}>
                {visibleMatches.map((m) => {
                  const outcome = ownerOutcome(m)
                  const outcomeLabel = outcome === "won" ? "Won" : outcome === "lost" ? "Lost" : outcome === "open" ? "In Progress" : "Hot-seat"
                  return (<li key={m.id}>
                    <button
                      className={styles.profileHistoryRow}
                      disabled={!m.finished_at}
                      type="button"
                      onClick={() => m.finished_at && void openReplay(m.id)}>
                      <span
                        aria-hidden="true"
                        className={`${styles.profileMatchIcon} ${MATCH_ICON_CLASS[modeIcon(m.mode)]}`}>
                        <span/>
                      </span>
                      <span className={styles.profileHistoryCopy}>
                        <span>
                          {MODE_LABEL[m.mode] ?? m.mode}
                          <em> to {m.target}</em>
                        </span>
                        <small>
                          {formatDate(m.finished_at ?? m.started_at)}
                          {m.game_count > 0 && ` - ${m.game_count} game${m.game_count > 1 ? "s" : ""}`}
                        </small>
                      </span>
                      <span className={styles.profileHistoryScore}>
                        {m.white_score} - {m.black_score}
                      </span>
                      <span
                        className={`${styles.profileHistoryStatus} ${HISTORY_OUTCOME_CLASS[outcome]}`}>
                        {outcomeLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className={styles.profileHistoryChevron}>
                        ›
                      </span>
                    </button>
                  </li>)
                })}
              </ul>
            </div>)}
        </section>
      </div>
    </div>
  </main>)
}

/**
 * Profile-page CurrencyPill — same VISUAL design as the lobby's
 * top-bar pill, but does NOT reuse the lobby's CSS class names
 * (`.lobby-currency-pill`, `.lobby-currency-icon`, etc).
 *
 * Why: the lobby has desktop-only overrides like
 *   .lobby-currency-icon { width: calc(46 * var(--lobby-u)); }
 * where `--lobby-u` is defined on `.lobby-shell`. Outside that
 * scope (e.g. on /profile) `--lobby-u` is undefined → the calc()
 * becomes invalid → width falls back to `auto` → the <img>
 * renders at its intrinsic webp size (~512-1024px), which on the
 * profile page made the icons full-screen.
 *
 * Update: to make these EXACTLY match the lobby pills (the operator
 * kept seeing a mismatch — the lobby restyles its pills via the
 * `.lobby-currency-*` rules into a flat, --lobby-u-scaled shape with a
 * green-bordered "+", which the bare Tailwind copy never reproduced),
 * we now reuse the `.lobby-currency-*` class hooks AND supply
 * `--lobby-u` ourselves on `.profile-top-currency` (landscape uses the
 * same formula as `.lobby-shell`; portrait uses a fixed fallback) plus
 * an explicit pill height, so the lobby rules resolve correctly here.
 */
function CurrencyPill({
  flyTarget,
  icon,
  label,
  value,
  onAdd,
}: {
  readonly flyTarget: "coins" | "gems" | "xp",
  readonly icon: string,
  readonly label: string,
  readonly value: number,
  readonly onAdd: () => void,
}) {
  return (<div
    aria-label={`${label}: ${value ?? 0}`}
    className={`lobby-currency-pill ${styles.profileCurrencyPill}`}
    data-fly-target={flyTarget}>
    <span className={`lobby-currency-icon ${styles.profileCurrencyIcon}`}>
      <img
        alt=""
        className={styles.profileCurrencyImg}
        draggable={false}
        src={icon}/>
    </span>
    <span className={`lobby-currency-value ${styles.profileCurrencyValue}`}>
      {formatCompactNumber(value)}
    </span>
    <button
      aria-label={`Get more ${label}`}
      className={`lobby-currency-add ${styles.profileCurrencyAdd}`}
      type="button"
      onClick={onAdd}>
      <span className={`${styles.profileCurrencyPlus} ${styles.profileCurrencyPlusH}`}/>
      <span className={styles.profileCurrencyPlus}/>
    </button>
  </div>)
}

function Stat({
  icon,
  label,
  value,
  wide = false,
}: {
  readonly icon: "coins" | "gems" | "finished" | "wins" | "losses" | "hotseat",
  readonly label: string,
  readonly value: number,
  readonly wide?: boolean,
}) {
  // Coins + Gems use the real webp icons (same artwork as the
  // wallet pills + lobby) instead of the CSS-painted profile-
  // stat-icon sprites. Other stat icons stay on the sprites.
  const realIcon = icon === "coins" ? "/lobby/icons/gold-coin.webp" : icon === "gems" ? "/lobby/icons/gem.webp" : null

  return (<div className={`${styles.profileStatCard}${wide ? ` ${styles.profileStatCardWide}` : ""}`}>
    {realIcon ? (<span
      aria-hidden="true"
      className={styles.profileStatIconWrap}>
      <img
        alt=""
        className={styles.profileStatImg}
        draggable={false}
        src={realIcon}/>
    </span>) : (<span
      aria-hidden="true"
      className={`${styles.profileStatIcon} ${STAT_ICON_CLASS[icon]}`}>
      <span/>
    </span>)}
    {/* text-[1.35rem] is smaller than the previous default (~2rem
          via .profile-stat-card strong) so a value like "16.6K" fits
          comfortably without overflowing the stat box. */}
    <strong className={styles.profileStatValue}>{formatCompactNumber(value)}</strong>
    <small>{label}</small>
  </div>)
}
