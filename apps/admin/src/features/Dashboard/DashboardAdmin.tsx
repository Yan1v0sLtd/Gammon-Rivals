import {useEffect} from "react"

import {formatDate} from "../../lib/formatDate.ts"
import {formatNumber} from "../../lib/formatNumber"
import {useGetAuditLogQuery} from "../AdminAccess/AdminAccessApi"
import {useGetBoardsQuery} from "../BoardThemes/BoardThemesApi"
import {useGetTablesQuery} from "../Difficulties/DifficultiesApi"
import {useGetLevelConfigsQuery} from "../LevelSystem/LevelSystemApi"

import styles from "./DashboardAdmin.module.css"
import {useGetDashboardStatsQuery} from "./DashboardApi"

type Props = {
  readonly onError: (error: unknown) => void,
}

/**
 * Dashboard BO admin — the landing section. Owns its own data: the
 * headline counts come from the Dashboard stats query, the "Game
 * config" count sums the shared Level System / Difficulties / Board
 * Themes caches (RTK Query dedupes by cache key, so subscribing here
 * is not a second server call), and the recent-changes feed reads the
 * Admin Access audit cache the same way. Query failures are reported
 * up through `onError` for page-level display. No direct Supabase
 * calls here.
 */
export function DashboardAdmin({onError}: Props) {
  // refetchOnMountOrArgChange mirrors the legacy behavior where the
  // counts were refreshed by loadAdminData before the section opened.
  const {
    data: stats,
    error: statsError,
  } = useGetDashboardStatsQuery(undefined, {refetchOnMountOrArgChange: true})
  const {
    data: audit = [],
    error: auditError,
  } = useGetAuditLogQuery()
  const {
    data: tables = [],
    error: tablesError,
  } = useGetTablesQuery()
  const {
    data: boards = [],
    error: boardsError,
  } = useGetBoardsQuery()
  const {
    data: levelConfigs = [],
    error: levelConfigsError,
  } = useGetLevelConfigsQuery()

  // Surface any fetch failure through the page-level error reporter.
  useEffect(() => {
    const firstError = statsError ?? auditError ?? tablesError ?? boardsError ?? levelConfigsError
    if (firstError) onError(firstError)
  }, [statsError, auditError, tablesError, boardsError, levelConfigsError, onError])

  const configItems = tables.length + boards.length + levelConfigs.length
  const cards = [{
    label: "Users",
    value: formatNumber(stats?.users ?? 0),
    caption: `${stats?.suspendedUsers ?? 0} suspended`,
  }, {
    label: "Matches",
    value: formatNumber(stats?.matches ?? 0),
    caption: "Visible to admins",
  }, {
    label: "Active matches",
    value: formatNumber(stats?.activeMatches ?? 0),
    caption: "Currently open",
  }, {
    label: "Game config",
    value: formatNumber(configItems),
    caption: "Levels, rooms, themes",
  }, {
    label: "Shop items",
    value: formatNumber(stats?.shopItems ?? 0),
    caption: "Products and offers",
  }]

  return (<div className={styles.wrap}>
    <div className={styles.cardGrid}>
      {cards.map((card) => (<div
        key={card.label}
        className={styles.statCard}>
        <div className={styles.statLabel}>
          {card.label}
        </div>
        <div className={styles.statValue}>{card.value}</div>
        <div className={styles.statCaption}>{card.caption}</div>
      </div>))}
    </div>
    <div className={styles.mainGrid}>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Operations readiness</h2>
        <div className={styles.readinessGrid}>
          <div className={styles.readinessBox}>
            Wallets and ledger are ready for admin grants, match rewards, purchases, refunds,
            and daily bonuses.
          </div>
          <div className={styles.readinessBox}>
            Shop config is ready before the game shop exists, so the gameplay UI can plug into
            live products later.
          </div>
        </div>
      </div>
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Recent changes</h2>
        <div className={styles.auditList}>
          {audit.length === 0 ? (<div className={styles.auditEmpty}>No admin changes
            yet.</div>) : (audit.slice(0, 6).map((entry) => (<div
            key={entry.id}
            className={styles.auditRow}>
            <div className={styles.auditAction}>{entry.action}</div>
            <div className={styles.auditEntity}>
              {entry.entity_table} · {entry.entity_id}
            </div>
            <div className={styles.auditDate}>{formatDate(entry.created_at)}</div>
          </div>)))}
        </div>
      </div>
    </div>
  </div>)
}
