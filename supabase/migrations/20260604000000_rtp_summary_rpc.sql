-- RTP summary aggregation for the BO dashboard.
--
-- Per-tier numbers operators need to tune the economy:
--   matches_played    — count of finished difficulty-room matches
--   matches_won       — owner wins (winner = owner_color)
--   coins_wagered     — sum of entry_fee debits routed to this tier
--   coins_paid_out    — sum of match_reward credits routed to this tier
--   coins_house_net   — wagered - paid_out (the system's coin extraction)
--   actual_win_rate   — won / played, percent
--   actual_rtp_pct    — paid_out / wagered, percent
--   rtp_delta_pct     — actual - target (positive = paying too much)
--   risk_free_count   — number of payouts where risk_free metadata=true
--
-- All metrics support an optional `p_since` timestamp so the dashboard
-- can switch between "last 24h / 7d / 30d / all-time" without a code
-- change. p_since = null means "all time".
--
-- Reads three tables:
--   public.matches               — for played/won counts
--   public.wallet_transactions   — for wagered (source='entry_fee')
--                                  and paid_out (source='match_reward').
--                                  Both kinds of rows carry the
--                                  table_config_id inside metadata.
--   public.table_configs         — for the tier display_name and
--                                  target_rtp_pct, plus the LEFT JOIN
--                                  anchor so tiers with zero traffic
--                                  still appear with 0s.
--
-- OUT parameter names are prefixed `out_` because the plpgsql
-- query planner reports "ambiguous column" when an OUT name (e.g.
-- display_name) collides with a real column on table_configs the
-- CTE pulls from.
--
-- Admin-only: caller must hold any admin_roles role
-- (owner/admin/support/viewer). Read-only; idempotent.

drop function if exists public.get_rtp_summary(timestamptz);

create or replace function public.get_rtp_summary(
  p_since timestamptz default null
)
returns table (
  out_table_config_id text,
  out_display_name text,
  out_target_rtp_pct int,
  out_matches_played bigint,
  out_matches_won bigint,
  out_actual_win_rate_pct numeric,
  out_coins_wagered bigint,
  out_coins_paid_out bigint,
  out_coins_house_net bigint,
  out_actual_rtp_pct numeric,
  out_rtp_delta_pct numeric,
  out_risk_free_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.is_admin(caller_id) then
    raise exception 'not_admin';
  end if;

  return query
  with tier_rows as (
    select tc.id as tid, tc.display_name as dn, tc.target_rtp_pct as trp
    from public.table_configs tc
    where tc.kind = 'difficulty'
  ),
  match_stats as (
    select
      m.table_config_id as tid,
      count(*) as played,
      count(*) filter (where m.winner = m.owner_color) as won
    from public.matches m
    where m.table_config_id is not null
      and m.finished_at is not null
      and (p_since is null or m.finished_at >= p_since)
    group by m.table_config_id
  ),
  fee_stats as (
    select
      (wt.metadata ->> 'table_config_id') as tid,
      sum(-wt.amount)::bigint as wagered
    from public.wallet_transactions wt
    where wt.source = 'entry_fee'
      and wt.currency = 'coins'
      and (p_since is null or wt.created_at >= p_since)
    group by (wt.metadata ->> 'table_config_id')
  ),
  payout_stats as (
    select
      (wt.metadata ->> 'table_config_id') as tid,
      sum(wt.amount)::bigint as paid,
      count(*) filter (
        where (wt.metadata ->> 'risk_free')::boolean is true
      ) as risk_free
    from public.wallet_transactions wt
    where wt.source = 'match_reward'
      and wt.currency = 'coins'
      and (p_since is null or wt.created_at >= p_since)
    group by (wt.metadata ->> 'table_config_id')
  )
  select
    t.tid,
    t.dn,
    t.trp,
    coalesce(ms.played, 0),
    coalesce(ms.won, 0),
    case when coalesce(ms.played, 0) > 0
      then round(100.0 * ms.won / ms.played, 1)
      else null
    end,
    coalesce(fs.wagered, 0),
    coalesce(ps.paid, 0),
    coalesce(fs.wagered, 0) - coalesce(ps.paid, 0),
    case when coalesce(fs.wagered, 0) > 0
      then round(100.0 * coalesce(ps.paid, 0) / fs.wagered, 1)
      else null
    end,
    case when coalesce(fs.wagered, 0) > 0
      then round(100.0 * coalesce(ps.paid, 0) / fs.wagered, 1) - t.trp
      else null
    end,
    coalesce(ps.risk_free, 0)
  from tier_rows t
  left join match_stats ms on ms.tid = t.tid
  left join fee_stats fs on fs.tid = t.tid
  left join payout_stats ps on ps.tid = t.tid
  order by t.tid;
end;
$$;

grant execute on function public.get_rtp_summary(timestamptz) to authenticated;

comment on function public.get_rtp_summary(timestamptz) is
  'Per-difficulty-tier RTP aggregation for the BO dashboard. Admin-only. Reads matches + wallet_transactions joined by table_config_id (stored in wt.metadata). Optional p_since restricts to a time window; null = all time. Returns one row per difficulty tier even when there is no traffic. Raises: not_authenticated, not_admin.';
