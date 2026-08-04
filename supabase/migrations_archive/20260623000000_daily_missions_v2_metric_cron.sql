-- Daily Missions v2 — nightly metric + tier recompute cron.
--
-- Phase 2 of the Daily Missions feature per docs/specs/daily-missions.md.
--
-- This migration delivers:
--   • The `recompute_daily_mission_metrics()` Postgres function that
--     rebuilds player_metrics (from existing source tables),
--     metric_distributions (population percentiles), and
--     player_metric_tiers (casual/regular/whale derivation).
--   • A pg_cron schedule that runs the function at 02:00 UTC daily.
--
-- The function is split into THREE conceptual steps so a re-read
-- maps cleanly to the spec's diagram:
--   1. Recompute player_metrics from source tables (matches,
--      wallet_transactions, player_daily_missions).
--   2. Recompute metric_distributions — for each metric_code,
--      the 10/25/33/50/66/75/90/95 percentile breakpoints over
--      players with non-zero baseline.
--   3. Derive player_metric_tiers from each player's baseline
--      vs the metric's p33/p66 breakpoints.
--
-- A few metrics deliberately defer to Phase 4 event hooks instead
-- of being source-derived here:
--   • win_streak           — needs match-by-match scan; cheaper to
--                            update incrementally from finish_match.
--   • levels_per_week      — could be derived from wallet_transactions
--                            source='level_reward' but Phase 4 hook is
--                            cleaner (single source of truth at
--                            level-up time).
--   • xp_per_day           — no XP ledger today; Phase 4 hook required.
--   • rating_diff_won      — needs match-time rating snapshot.
--   • matches_at_difficulty_<id> — derived from matches.mode in the
--                            hook (the cron-derived matches_per_day
--                            already covers volume; difficulty filters
--                            are mission-time logic, not population
--                            stats).
--
-- The function is idempotent — re-running it produces the same
-- player_metrics, metric_distributions, and tier assignments.

-- ============================================================
-- Section 1: enable pg_cron.
--
-- Supabase ships pg_cron available-but-not-installed by default.
-- This is a no-op when already enabled.
-- ============================================================
create extension if not exists pg_cron;

-- ============================================================
-- Section 2: recompute_daily_mission_metrics()
-- ============================================================
create or replace function public.recompute_daily_mission_metrics()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ────────────────────────────────────────────────────────────
  -- Step 1: Recompute source-derived player_metrics.
  --
  -- Each metric is an UPSERT keyed on (profile_id, metric_code).
  -- value_today = events in the last 24h (informational).
  -- baseline_7d = avg-per-day over the last 7 days (drives
  --               stretch resolution + tier derivation).
  -- ────────────────────────────────────────────────────────────

  -- matches_per_day: owner + opponent both count toward THEIR
  -- own match counts. UNION ALL emits one row per player per
  -- match; the GROUP BY collapses.
  with all_match_events as (
    select owner_id as profile_id, finished_at
    from public.matches
    where finished_at is not null
      and finished_at > now() - interval '7 days'
      and owner_id is not null
    union all
    select opponent_id as profile_id, finished_at
    from public.matches
    where finished_at is not null
      and finished_at > now() - interval '7 days'
      and opponent_id is not null
  )
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'matches_per_day',
    (count(*) filter (where finished_at > now() - interval '1 day'))::int,
    (count(*)::numeric / 7.0)
  from all_match_events
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- coins_wagered_per_day: sum of entry_fee debits (amount is
  -- negative — we take abs to get the positive wager amount).
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'coins_wagered_per_day',
    coalesce((sum(abs(amount)) filter (where created_at > now() - interval '1 day'))::int, 0),
    coalesce(sum(abs(amount))::numeric / 7.0, 0)
  from public.wallet_transactions
  where source = 'entry_fee'
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- coins_won_net_per_day: net wallet movement across all match-
  -- related coin transactions. entry_fee debits are negative;
  -- match_reward credits are positive. Sum gives net P&L.
  -- Clamp to 0 because the "Win X coins net" mission shouldn't
  -- progress on a losing day.
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'coins_won_net_per_day',
    greatest(coalesce((sum(amount) filter (where created_at > now() - interval '1 day'))::int, 0), 0),
    greatest(coalesce(sum(amount)::numeric / 7.0, 0), 0)
  from public.wallet_transactions
  where source in ('match_reward', 'entry_fee')
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- gems_spent_per_day: gem debits via purchase. Future:
  -- mission_reroll_fee debits will count too — once Phase 5
  -- ships the reroll RPC, the source filter expands.
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'gems_spent_per_day',
    coalesce((sum(abs(amount)) filter (where created_at > now() - interval '1 day'))::int, 0),
    coalesce(sum(abs(amount))::numeric / 7.0, 0)
  from public.wallet_transactions
  where source in ('purchase', 'mission_reroll_fee')
    and currency = 'gems'
    and amount < 0
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- wheel_spins_per_day: count of source='wheel_spin' wallet rows.
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'wheel_spins_per_day',
    (count(*) filter (where created_at > now() - interval '1 day'))::int,
    (count(*)::numeric / 7.0)
  from public.wallet_transactions
  where source = 'wheel_spin'
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- missions_claimed_per_day: count of player_daily_missions rows
  -- with claimed_at in the window. Drives the meta-mission
  -- "complete N other missions today" baseline.
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'missions_claimed_per_day',
    (count(*) filter (where claimed_at > now() - interval '1 day'))::int,
    (count(*)::numeric / 7.0)
  from public.player_daily_missions
  where claimed_at is not null
    and claimed_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- ranked_wins_per_week: online-mode matches the player won.
  -- This is a weekly metric, so value_today is meaningless (the
  -- Weekly Challenge slot reads baseline_7d which already
  -- represents the full week's count, not per-day average).
  -- We store the WEEKLY TOTAL in baseline_7d here, not the
  -- daily average — special-cased because weekly missions
  -- target weekly totals, not daily rates.
  with online_wins as (
    -- Owner won
    select owner_id as profile_id
    from public.matches
    where mode = 'online'
      and finished_at is not null
      and finished_at > now() - interval '7 days'
      and winner is not null
      and winner = owner_color
      and owner_id is not null
    union all
    -- Opponent won (winner = the OTHER color from owner_color)
    select opponent_id as profile_id
    from public.matches
    where mode = 'online'
      and finished_at is not null
      and finished_at > now() - interval '7 days'
      and winner is not null
      and winner <> owner_color
      and opponent_id is not null
  )
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select
    profile_id,
    'ranked_wins_per_week',
    0::int,  -- weekly metric, daily snapshot is not meaningful
    count(*)::numeric  -- store the weekly TOTAL, not /7.0
  from online_wins
  group by profile_id
  on conflict (profile_id, metric_code) do update set
    value_today = excluded.value_today,
    baseline_7d = excluded.baseline_7d,
    updated_at = now();

  -- ────────────────────────────────────────────────────────────
  -- Step 2: Recompute metric_distributions (percentiles).
  --
  -- For each metric_code, compute the breakpoint values at
  -- p10, p25, p33, p50, p66, p75, p90, p95. p33/p66 are used
  -- for tier derivation; the wider set lets the BO operator
  -- author mission goal_min/goal_max informed by the
  -- distribution shape.
  --
  -- We DELETE then INSERT inside the function's transaction so
  -- concurrent readers see a consistent snapshot (Postgres MVCC).
  -- ────────────────────────────────────────────────────────────
  delete from public.metric_distributions;

  insert into public.metric_distributions (metric_code, percentile, value)
  select
    pm.metric_code,
    p.percentile,
    coalesce(percentile_cont(p.percentile / 100.0) within group (order by pm.baseline_7d), 0)::numeric(12,2)
  from public.player_metrics pm
  cross join lateral (
    values (10), (25), (33), (50), (66), (75), (90), (95)
  ) as p(percentile)
  where pm.baseline_7d > 0
  group by pm.metric_code, p.percentile;

  -- ────────────────────────────────────────────────────────────
  -- Step 3: Derive player_metric_tiers.
  --
  -- casual:  baseline_7d below the population's p33 for this
  --          metric. The default tier — also the fallback when a
  --          player has no activity (baseline = 0) or when the
  --          population is too small for percentiles to exist.
  -- regular: p33 ≤ baseline_7d < p66.
  -- whale:   baseline_7d ≥ p66.
  --
  -- The coalesce(..., 99999999) on the whale bound and
  -- coalesce(..., 0) on the regular bound is the defensive
  -- guard for the early-lifecycle case where metric_distributions
  -- doesn't yet have rows for this metric — without it, the
  -- comparison would evaluate to NULL and the case fall through
  -- to the else branch (casual), which is fine, but the explicit
  -- coalesce makes intent obvious.
  -- ────────────────────────────────────────────────────────────
  insert into public.player_metric_tiers (profile_id, metric_code, tier)
  select
    pm.profile_id,
    pm.metric_code,
    case
      when pm.baseline_7d <= 0 then 'casual'
      when pm.baseline_7d >= coalesce(
        (select value from public.metric_distributions
         where metric_code = pm.metric_code and percentile = 66),
        99999999
      ) then 'whale'
      when pm.baseline_7d >= coalesce(
        (select value from public.metric_distributions
         where metric_code = pm.metric_code and percentile = 33),
        0
      ) then 'regular'
      else 'casual'
    end
  from public.player_metrics pm
  on conflict (profile_id, metric_code) do update set
    tier = excluded.tier,
    updated_at = now();
end;
$$;

comment on function public.recompute_daily_mission_metrics() is
  'Nightly recompute of Daily Missions metrics. Rebuilds player_metrics from source tables (matches, wallet_transactions, player_daily_missions), metric_distributions (percentile breakpoints), and player_metric_tiers (casual/regular/whale). Idempotent — safe to re-run.';

-- ============================================================
-- Section 3: pg_cron schedule.
--
-- Runs at 02:00 UTC daily. The chosen time:
--   • Is well after the daily assignment cron (00:00 UTC) so
--     the assignment uses YESTERDAY's metric snapshot, which
--     is correct — players should be assigned missions
--     calibrated to their LAST WEEK's behaviour, not the
--     instant before assignment.
--   • Avoids the spike of user traffic around midnight UTC.
--
-- Idempotent: drop any prior schedule with this name before
-- creating, so re-applying the migration doesn't create
-- duplicates.
-- ============================================================
do $$
begin
  perform cron.unschedule('daily-missions-recompute-metrics');
exception when others then
  null;  -- job didn't exist; that's fine
end;
$$;

select cron.schedule(
  'daily-missions-recompute-metrics',
  '0 2 * * *',
  $cron$select public.recompute_daily_mission_metrics()$cron$
);

-- ============================================================
-- Section 4: One-time backfill on apply.
--
-- Run the recompute once so player_metrics, metric_distributions,
-- and player_metric_tiers are populated immediately — otherwise
-- the very first Phase 3 assignment run (before the first 02:00
-- cron tick) would have nothing to read and every mission would
-- resolve to the goal_min clamp.
-- ============================================================
select public.recompute_daily_mission_metrics();
