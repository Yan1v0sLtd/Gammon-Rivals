import {Fragment} from "react"

import {SecondaryButton} from "../../components/SecondaryButton"
import {formatNumber} from "../../lib/formatNumber"

import {useGetRtpPerPlayerQuery, useGetRtpSummaryQuery} from "./RTPAnalyticsApi"
import {RTP_RANGES, type RtpRangeId} from "./RTPAnalyticsData"

type Props = {
  readonly rtpRange: RtpRangeId,
  readonly rtpExpandedTier: string | null,
  readonly onSetRtpRange: (id: RtpRangeId) => void,
  readonly onToggleTier: (tierId: string) => void,
  readonly onOpenUser: (profileId: string) => void,
}

/**
 * RTP Analytics BO admin — per-tier wagered / paid out / house take and
 * actual vs target RTP, with a per-player drill-down on each tier row.
 */
export function RTPAnalyticsAdmin({
  rtpRange,
  rtpExpandedTier,
  onSetRtpRange,
  onToggleTier,
  onOpenUser,
}: Props) {
  const {
    data: rtpRows = [],
    error: rtpQueryError,
    isFetching: rtpLoading,
    refetch: refreshRtpSummary,
  } = useGetRtpSummaryQuery(rtpRange, {refetchOnMountOrArgChange: true})
  const {
    data: rtpPlayerRows = [],
    error: rtpPlayerQueryError,
    isFetching: rtpPlayerLoading,
  } = useGetRtpPerPlayerQuery({
    tableConfigId: rtpExpandedTier ?? "",
    range: rtpRange,
  }, {
    skip: rtpExpandedTier === null,
    refetchOnMountOrArgChange: true,
  })
  const rtpError = rtpLoading ? null : rtpQueryError?.message ?? null
  const rtpPlayerError = rtpPlayerLoading ? null : rtpPlayerQueryError?.message ?? null
  return (<div className="space-y-4">
    {/* Header: range selector + refresh. The summary is
          * fetched lazily when the section opens; changing the
          * range re-fires the RPC. Numbers are computed server-side
          * by get_rtp_summary against matches +
          * wallet_transactions, so this view stays cheap on the
          * client even when match count grows. */}
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div>
        <h2 className="text-lg font-black">RTP Analytics</h2>
        <p className="mt-1 text-sm text-white/50">
          Per-tier wagered, paid out, house take, and actual vs target RTP. Drives the
          economy tuning loop — re-balance W / L / fee in the Difficulties tab when delta
          drifts away from zero.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {RTP_RANGES.map((range) => (<button
          key={range.id}
          className={"rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition " + (rtpRange === range.id ? "border-amber-300/60 bg-amber-300/15 text-amber-200" : "border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]")}
          type="button"
          onClick={() => {
            onSetRtpRange(range.id)
          }}>
          {range.label}
        </button>))}
        <SecondaryButton
          disabled={rtpLoading}
          onClick={refreshRtpSummary}>
          {rtpLoading ? "Loading…" : "Refresh"}
        </SecondaryButton>
      </div>
    </div>

    {rtpError ? (
      <div className="rounded-md border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
        {rtpError}
      </div>) : null}

    <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.045]">
      <table className="min-w-full text-sm">
        <thead
          className="border-b border-white/10 bg-white/[0.04] text-left text-[0.65rem] font-bold uppercase tracking-[0.14em] text-white/45">
          <tr>
            <th className="px-3 py-2">Tier</th>
            <th className="px-3 py-2 text-right">Matches</th>
            <th className="px-3 py-2 text-right">Win rate</th>
            <th className="px-3 py-2 text-right">Wagered</th>
            <th className="px-3 py-2 text-right">Paid out</th>
            <th className="px-3 py-2 text-right">House net</th>
            <th className="px-3 py-2 text-right">Target RTP</th>
            <th className="px-3 py-2 text-right">Actual RTP</th>
            <th className="px-3 py-2 text-right">Delta</th>
            <th className="px-3 py-2 text-right">Risk-free</th>
          </tr>
        </thead>
        <tbody>
          {rtpRows.length === 0 && !rtpLoading ? (<tr>
            <td
              className="px-3 py-6 text-center text-white/40"
              colSpan={10}>
              No difficulty matches in this window yet.
            </td>
          </tr>) : (rtpRows.map((row) => {
            const delta = row.out_rtp_delta_pct
            const deltaColor = delta === null ? "text-white/30" : delta > 3 ? "text-rose-300" : delta < -3 ? "text-emerald-300" : "text-amber-200"
            const isExpanded = rtpExpandedTier === row.out_table_config_id
            const hasTraffic = row.out_matches_played > 0 || row.out_coins_wagered > 0
            return (<Fragment key={row.out_table_config_id}>
              <tr
                className={`border-b border-white/5 last:border-b-0 ${hasTraffic ? "cursor-pointer hover:bg-white/[0.03]" : ""} ${isExpanded ? "bg-white/[0.04]" : ""}`}
                onClick={() => {
                  if (!hasTraffic) return
                  onToggleTier(row.out_table_config_id)
                }}>
                <td className="px-3 py-2 font-bold text-white/85">
                  <span className="mr-1 inline-block w-3 text-white/40">
                    {hasTraffic ? (isExpanded ? "▾" : "▸") : ""}
                  </span>
                  {row.out_display_name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {formatNumber(row.out_matches_played)}
                  {row.out_matches_played > 0 ? (<span
                    className="ml-1 text-white/40">({formatNumber(row.out_matches_won)}W)</span>) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {row.out_actual_win_rate_pct !== null ? `${row.out_actual_win_rate_pct}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {formatNumber(row.out_coins_wagered)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {formatNumber(row.out_coins_paid_out)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {formatNumber(row.out_coins_house_net)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/55">
                  {row.out_target_rtp_pct}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-white/85">
                  {row.out_actual_rtp_pct !== null ? `${row.out_actual_rtp_pct}%` : "—"}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${deltaColor}`}>
                  {delta !== null ? `${delta > 0 ? "+" : ""}${delta}` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/55">
                  {formatNumber(row.out_risk_free_count)}
                </td>
              </tr>
              {isExpanded ? (<tr className="border-b border-white/5 bg-black/30">
                <td
                  className="px-3 py-3"
                  colSpan={10}>
                  {rtpPlayerError ? (<div
                    className="rounded-md border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                    {rtpPlayerError}
                  </div>) : rtpPlayerLoading && rtpPlayerRows.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-white/40">Loading
                      players…</div>) : rtpPlayerRows.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-white/40">
                      No player data in this window.
                    </div>) : (<table className="min-w-full text-xs">
                    <thead
                      className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/40">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Player</th>
                        <th className="px-2 py-1.5 text-right">Matches</th>
                        <th className="px-2 py-1.5 text-right">Win rate</th>
                        <th className="px-2 py-1.5 text-right">Wagered</th>
                        <th className="px-2 py-1.5 text-right">Paid out</th>
                        <th className="px-2 py-1.5 text-right">House net</th>
                        <th className="px-2 py-1.5 text-right">RTP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rtpPlayerRows.map((pr) => {
                        // Per-player RTP colouring is opposite of the
                        // tier-level delta: here, high RTP means this
                        // specific player is winning more than the tier
                        // target — possibly a streaking expert or a bot.
                        // Low RTP just means they're unlucky / new.
                        const rtp = pr.out_actual_rtp_pct
                        const playerRtpColor = rtp === null ? "text-white/40" : rtp > 110 ? "text-rose-300" : rtp > 95 ? "text-amber-200" : "text-white/70"
                        return (<tr
                          key={pr.out_profile_id}
                          className="border-t border-white/5">
                          <td className="px-2 py-1.5">
                            <button
                              className="text-white/85 hover:text-amber-200"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenUser(pr.out_profile_id)
                              }}>
                              {pr.out_display_name}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                            {formatNumber(pr.out_matches_played)}
                            {pr.out_matches_played > 0 ? (<span
                              className="ml-1 text-white/40">({pr.out_matches_won}W)</span>) : null}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                            {pr.out_win_rate_pct !== null ? `${pr.out_win_rate_pct}%` : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                            {formatNumber(pr.out_coins_wagered)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                            {formatNumber(pr.out_coins_paid_out)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                            {formatNumber(pr.out_coins_house_net)}
                          </td>
                          <td
                            className={`px-2 py-1.5 text-right tabular-nums font-bold ${playerRtpColor}`}>
                            {rtp !== null ? `${rtp}%` : "—"}
                          </td>
                        </tr>)
                      })}
                    </tbody>
                  </table>)}
                </td>
              </tr>) : null}
            </Fragment>)
          }))}
        </tbody>
      </table>
    </div>

    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
      <strong className="text-white/70">How to read this:</strong> Delta = Actual RTP − Target RTP. Negative
      means
      players are losing more than you targeted (house overshooting). Positive means players are winning more
      (house
      bleeding). Wait for ~50 matches per tier before re-tuning — anything below that is dice variance, not
      signal.
      Risk-free is the count of payouts upgraded to full entry-fee refund under the first-10-matches
      onboarding rule.
    </div>
  </div>)
}
