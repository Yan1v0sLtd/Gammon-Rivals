-- Per-player RTP drill-down for the BO dashboard.
--
-- Tier-aggregate numbers (get_rtp_summary) tell you the population
-- average. Per-player numbers tell you who's pulling that average off
-- target. The dashboard expand-on-click surface uses this RPC to show:
--
--   profile_id, display_name
--   matches_played in this tier
--   matches_won
--   win_rate %
--   coins_wagered (sum of entry fees this player paid into this tier)
--   coins_paid_out (sum of match rewards this player got back)
--   coins_house_net (wagered - paid_out from the house perspective)
--   actual_rtp_pct (per-player RTP in this tier)
--
-- Ordered by absolute house_net desc — so the biggest economy movers
-- (in either direction) bubble to the top. Top winners AND top losers
-- are both interesting: hot streakers might be bots, big losers might
-- be churning.
--
-- p_limit caps the result so an outlier tier with thousands of
-- players doesn't dump everything to the client. Default 50, max 200.

create or replace function public.get_rtp_per_player(
  p_table_config_id text,
  p_since timestamptz default null,
  p_limit int default 50
)
returns table (
  out_profile_id uuid,
  out_display_name text,
  out_matches_played bigint,
  out_matches_won bigint,
  out_win_rate_pct numeric,
  out_coins_wagered bigint,
  out_coins_paid_out bigint,
  out_coins_house_net bigint,
  out_actual_rtp_pct numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  cap int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.is_admin(caller_id) then
    raise exception 'not_admin';
  end if;

  return query
  with match_stats as (
    select
      m.owner_id as pid,
      count(*) as played,
      count(*) filter (where m.winner = m.owner_color) as won
    from public.matches m
    where m.table_config_id = p_table_config_id
      and m.finished_at is not null
      and (p_since is null or m.finished_at >= p_since)
    group by m.owner_id
  ),
  fee_stats as (
    select
      wt.profile_id as pid,
      sum(-wt.amount)::bigint as wagered
    from public.wallet_transactions wt
    where wt.source = 'entry_fee'
      and wt.currency = 'coins'
      and (wt.metadata ->> 'table_config_id') = p_table_config_id
      and (p_since is null or wt.created_at >= p_since)
    group by wt.profile_id
  ),
  payout_stats as (
    select
      wt.profile_id as pid,
      sum(wt.amount)::bigint as paid
    from public.wallet_transactions wt
    where wt.source = 'match_reward'
      and wt.currency = 'coins'
      and (wt.metadata ->> 'table_config_id') = p_table_config_id
      and (p_since is null or wt.created_at >= p_since)
    group by wt.profile_id
  ),
  joined as (
    -- Union-all of profiles that appear in any of the three CTEs.
    -- This is the universe of players who touched this tier in the
    -- window. We join all three back to it; missing values fall to 0.
    select distinct pid from (
      select pid from match_stats
      union all
      select pid from fee_stats
      union all
      select pid from payout_stats
    ) u
  )
  select
    j.pid,
    coalesce(p.display_name, '(deleted)'),
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
    end
  from joined j
  left join public.profiles p on p.id = j.pid
  left join match_stats ms on ms.pid = j.pid
  left join fee_stats fs on fs.pid = j.pid
  left join payout_stats ps on ps.pid = j.pid
  order by abs(coalesce(fs.wagered, 0) - coalesce(ps.paid, 0)) desc, coalesce(ms.played, 0) desc
  limit cap;
end;
$$;

grant execute on function public.get_rtp_per_player(text, timestamptz, int) to authenticated;

comment on function public.get_rtp_per_player(text, timestamptz, int) is
  'Per-player RTP drill-down for one difficulty tier. Admin-only. Same time-window semantics as get_rtp_summary; orders by absolute house net so the biggest movers (winners and losers) surface first. Raises: not_authenticated, not_admin.';
