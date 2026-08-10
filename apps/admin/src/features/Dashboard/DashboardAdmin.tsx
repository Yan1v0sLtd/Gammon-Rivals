import {useEffect} from "react"

import {formatDate} from "../../lib/formatDate.ts"
import {formatNumber} from "../../lib/formatNumber"
import {useGetAuditLogQuery} from "../AdminAccess/AdminAccessApi"
import {useGetBoardsQuery} from "../BoardThemes/BoardThemesApi"
import {useGetTablesQuery} from "../Difficulties/DifficultiesApi"
import {useGetLevelConfigsQuery} from "../LevelSystem/LevelSystemApi"

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

  return (<div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (<div
        key={card.label}
        className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.035] p-4 shadow-xl shadow-black/20">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">
          {card.label}
        </div>
        <div className="mt-3 text-3xl font-black text-amber-100">{card.value}</div>
        <div className="mt-1 text-xs text-white/45">{card.caption}</div>
      </div>))}
    </div>
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Operations readiness</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-black/15 p-3 text-sm text-white/60">
            Wallets and ledger are ready for admin grants, match rewards, purchases, refunds,
            and daily bonuses.
          </div>
          <div className="rounded-lg bg-black/15 p-3 text-sm text-white/60">
            Shop config is ready before the game shop exists, so the gameplay UI can plug into
            live products later.
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Recent changes</h2>
        <div className="mt-3 space-y-2">
          {audit.length === 0 ? (<div className="text-sm text-white/45">No admin changes
            yet.</div>) : (audit.slice(0, 6).map((entry) => (<div
            key={entry.id}
            className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs">
            <div className="font-bold capitalize text-white/80">{entry.action}</div>
            <div className="text-white/45">
              {entry.entity_table} · {entry.entity_id}
            </div>
            <div className="text-white/35">{formatDate(entry.created_at)}</div>
          </div>)))}
        </div>
      </div>
    </div>
  </div>)
}
