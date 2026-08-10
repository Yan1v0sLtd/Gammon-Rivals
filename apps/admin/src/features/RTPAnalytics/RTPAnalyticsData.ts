import {adminSupabase, isAdminSupabaseConfigured} from "../../lib/adminSupabase"

export const RTP_RANGES = [{
  id: "24h",
  label: "Last 24h",
  hours: 24,
}, {
  id: "7d",
  label: "Last 7d",
  hours: 24 * 7,
}, {
  id: "30d",
  label: "Last 30d",
  hours: 24 * 30,
}, {
  id: "all",
  label: "All time",
  hours: null,
}] as const

export type RtpRangeId = typeof RTP_RANGES[number]["id"]

/**
 * Shape returned by public.get_rtp_summary. The `out_` prefix avoids an
 * OUT-parameter/table-column collision in 20260604_rtp_summary_rpc.sql.
 */
export type RtpRow = {
  out_table_config_id: string,
  out_display_name: string,
  out_target_rtp_pct: number,
  out_matches_played: number,
  out_matches_won: number,
  out_actual_win_rate_pct: number | null,
  out_coins_wagered: number,
  out_coins_paid_out: number,
  out_coins_house_net: number,
  out_actual_rtp_pct: number | null,
  out_rtp_delta_pct: number | null,
  out_risk_free_count: number,
}

/** Shape returned by public.get_rtp_per_player. */
export type RtpPerPlayerRow = {
  out_profile_id: string,
  out_display_name: string,
  out_matches_played: number,
  out_matches_won: number,
  out_win_rate_pct: number | null,
  out_coins_wagered: number,
  out_coins_paid_out: number,
  out_coins_house_net: number,
  out_actual_rtp_pct: number | null,
}

export type RtpPerPlayerArgs = {
  tableConfigId: string,
  range: RtpRangeId,
}

function sinceForRange(rangeId: RtpRangeId): string | null {
  const range = RTP_RANGES.find(({id}) => id === rangeId)
  return range?.hours == null ? null : new Date(Date.now() - range.hours * 60 * 60 * 1000).toISOString()
}

export async function fetchRtpSummary(range: RtpRangeId): Promise<readonly RtpRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase.rpc("get_rtp_summary", {p_since: sinceForRange(range)})
  if (error) throw error
  return data ?? []
}

export async function fetchRtpPerPlayer({
  tableConfigId,
  range,
}: RtpPerPlayerArgs): Promise<readonly RtpPerPlayerRow[]> {
  if (!isAdminSupabaseConfigured) return []
  const {
    data,
    error,
  } = await adminSupabase.rpc("get_rtp_per_player", {
    p_table_config_id: tableConfigId,
    p_since: sinceForRange(range),
    p_limit: 50,
  })
  if (error) throw error
  return data ?? []
}
