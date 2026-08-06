import {skipToken} from "@reduxjs/toolkit/query/react"
import {Link, useNavigate} from "react-router-dom"

import {useAppSelector} from "../../store/hooks"
import {selectAuthUserId} from "../auth/authSelectors"
import {
  useGetMatchHistoryQuery,
  useLazyGetGamesForMatchQuery,
} from "../playerData/playerDataApi"

import {
  errorMessage,
  formatDate,
  MODE_LABEL,
  modeIcon,
  ownerOutcome,
} from "./profileHelpers"
import styles from "./ProfileMatchHistory.module.css"

export const MATCH_ICON_CLASS: Record<ReturnType<typeof modeIcon>, string> = {
  hotseat: styles.profileMatchIconHotseat,
  online: styles.profileMatchIconOnline,
  ai: styles.profileMatchIconAi,
}

export const HISTORY_OUTCOME_CLASS: Record<ReturnType<typeof ownerOutcome>, string> = {
  won: styles.profileHistoryStatusWon,
  lost: styles.profileHistoryStatusLost,
  open: styles.profileHistoryStatusOpen,
  hotseat: styles.profileHistoryStatusHotseat,
}

export function ProfileMatchHistory() {
  const userId = useAppSelector(selectAuthUserId)
  const navigate = useNavigate()
  const [getGamesForMatch] = useLazyGetGamesForMatchQuery()
  const {
    data: matches,
    error: historyError,
  } = useGetMatchHistoryQuery(userId ?? skipToken)

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

  // The list scrolls when > 4 entries thanks to the max-h + overflow-y-auto
  // wrapper applied around .profile-history-list in the JSX below.
  const visibleMatches = matches ?? null

  return (<section className={styles.profileHistoryPanel}>
    <h2>Match History</h2>
    {historyError && (<div className={`${styles.profilePanelMessage} ${styles.profilePanelMessageError}`}>
      {errorMessage(historyError)}
    </div>)}
    {visibleMatches === null ? (
      <div className={styles.profilePanelMessage}>Loading...</div>) : visibleMatches.length === 0 ? (
      <div className={styles.profilePanelMessage}>
        <span>No matches yet.</span>
        <Link to="/play">Start one</Link>
      </div>) : (// History panel fills the right column, so the inner scroll
      // container takes 100 % and shows ~10 rows on a landscape viewport.
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
  </section>)
}
