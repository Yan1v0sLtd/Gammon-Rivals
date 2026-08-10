import {Fragment} from "react"

import {SecondaryButton} from "../../components/SecondaryButton"
import {formatNumber} from "../../lib/formatNumber"

import styles from "./RTPAnalyticsAdmin.module.css"
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
  return (<div className={styles.container}>
    {/* Header: range selector + refresh. The summary is
          * fetched lazily when the section opens; changing the
          * range re-fires the RPC. Numbers are computed server-side
          * by get_rtp_summary against matches +
          * wallet_transactions, so this view stays cheap on the
          * client even when match count grows. */}
    <div className={styles.header}>
      <div>
        <h2 className={styles.title}>RTP Analytics</h2>
        <p className={styles.subtitle}>
          Per-tier wagered, paid out, house take, and actual vs target RTP. Drives the
          economy tuning loop — re-balance W / L / fee in the Difficulties tab when delta
          drifts away from zero.
        </p>
      </div>
      <div className={styles.rangeButtons}>
        {RTP_RANGES.map((range) => (<button
          key={range.id}
          className={styles.rangeButton + " " + (rtpRange === range.id ? styles.rangeButtonActive : styles.rangeButtonInactive)}
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

    {rtpError ? (<div className={styles.errorBox}>
      {rtpError}
    </div>) : null}

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Tier</th>
            <th className={styles.thRight}>Matches</th>
            <th className={styles.thRight}>Win rate</th>
            <th className={styles.thRight}>Wagered</th>
            <th className={styles.thRight}>Paid out</th>
            <th className={styles.thRight}>House net</th>
            <th className={styles.thRight}>Target RTP</th>
            <th className={styles.thRight}>Actual RTP</th>
            <th className={styles.thRight}>Delta</th>
            <th className={styles.thRight}>Risk-free</th>
          </tr>
        </thead>
        <tbody>
          {rtpRows.length === 0 && !rtpLoading ? (<tr>
            <td
              className={styles.emptyCell}
              colSpan={10}>
              No difficulty matches in this window yet.
            </td>
          </tr>) : (rtpRows.map((row) => {
            const delta = row.out_rtp_delta_pct
            const deltaColor = delta === null ? styles.deltaNull : delta > 3 ? styles.deltaHigh : delta < -3 ? styles.deltaLow : styles.deltaMid
            const isExpanded = rtpExpandedTier === row.out_table_config_id
            const hasTraffic = row.out_matches_played > 0 || row.out_coins_wagered > 0
            return (<Fragment key={row.out_table_config_id}>
              <tr
                className={styles.row + (hasTraffic ? " " + styles.rowClickable : "") + (isExpanded ? " " + styles.rowExpanded : "")}
                onClick={() => {
                  if (!hasTraffic) return
                  onToggleTier(row.out_table_config_id)
                }}>
                <td className={styles.cellBold}>
                  <span className={styles.tierCaret}>
                    {hasTraffic ? (isExpanded ? "▾" : "▸") : ""}
                  </span>
                  {row.out_display_name}
                </td>
                <td className={styles.cellRight}>
                  {formatNumber(row.out_matches_played)}
                  {row.out_matches_played > 0 ? (<span
                    className={styles.winCount}>({formatNumber(row.out_matches_won)}W)</span>) : null}
                </td>
                <td className={styles.cellRight}>
                  {row.out_actual_win_rate_pct !== null ? `${row.out_actual_win_rate_pct}%` : "—"}
                </td>
                <td className={styles.cellRight}>
                  {formatNumber(row.out_coins_wagered)}
                </td>
                <td className={styles.cellRight}>
                  {formatNumber(row.out_coins_paid_out)}
                </td>
                <td className={styles.cellRight}>
                  {formatNumber(row.out_coins_house_net)}
                </td>
                <td className={styles.cellRightDim}>
                  {row.out_target_rtp_pct}%
                </td>
                <td className={styles.cellRightBold}>
                  {row.out_actual_rtp_pct !== null ? `${row.out_actual_rtp_pct}%` : "—"}
                </td>
                <td className={styles.cellDelta + " " + deltaColor}>
                  {delta !== null ? `${delta > 0 ? "+" : ""}${delta}` : "—"}
                </td>
                <td className={styles.cellRightDim}>
                  {formatNumber(row.out_risk_free_count)}
                </td>
              </tr>
              {isExpanded ? (<tr className={styles.expandedRow}>
                <td
                  className={styles.expandedCell}
                  colSpan={10}>
                  {rtpPlayerError ? (<div
                    className={styles.playerError}>
                    {rtpPlayerError}
                  </div>) : rtpPlayerLoading && rtpPlayerRows.length === 0 ? (
                    <div className={styles.playerMessage}>Loading
                      players…</div>) : rtpPlayerRows.length === 0 ? (<div className={styles.playerMessage}>
                        No player data in this window.
                  </div>) : (<table className={styles.playerTable}>
                    <thead className={styles.playerThead}>
                      <tr>
                        <th className={styles.playerTh}>Player</th>
                        <th className={styles.playerThRight}>Matches</th>
                        <th className={styles.playerThRight}>Win rate</th>
                        <th className={styles.playerThRight}>Wagered</th>
                        <th className={styles.playerThRight}>Paid out</th>
                        <th className={styles.playerThRight}>House net</th>
                        <th className={styles.playerThRight}>RTP</th>
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
                        const playerRtpColor = rtp === null ? styles.playerRtpNull : rtp > 110 ? styles.playerRtpHigh : rtp > 95 ? styles.playerRtpMid : styles.playerRtpLow
                        return (<tr
                          key={pr.out_profile_id}
                          className={styles.playerRow}>
                          <td className={styles.playerCell}>
                            <button
                              className={styles.playerNameButton}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenUser(pr.out_profile_id)
                              }}>
                              {pr.out_display_name}
                            </button>
                          </td>
                          <td className={styles.playerCellRight}>
                            {formatNumber(pr.out_matches_played)}
                            {pr.out_matches_played > 0 ? (<span
                              className={styles.winCount}>({pr.out_matches_won}W)</span>) : null}
                          </td>
                          <td className={styles.playerCellRight}>
                            {pr.out_win_rate_pct !== null ? `${pr.out_win_rate_pct}%` : "—"}
                          </td>
                          <td className={styles.playerCellRight}>
                            {formatNumber(pr.out_coins_wagered)}
                          </td>
                          <td className={styles.playerCellRight}>
                            {formatNumber(pr.out_coins_paid_out)}
                          </td>
                          <td className={styles.playerCellRight}>
                            {formatNumber(pr.out_coins_house_net)}
                          </td>
                          <td
                            className={styles.playerCellRtp + " " + playerRtpColor}>
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

    <div className={styles.footnote}>
      <strong className={styles.footnoteStrong}>How to read this:</strong> Delta = Actual RTP − Target RTP. Negative
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
