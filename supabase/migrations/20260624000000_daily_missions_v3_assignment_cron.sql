-- Daily Missions v3 — daily assignment cron.
--
-- Phase 3 of the Daily Missions feature per docs/specs/daily-missions.md.
--
-- This migration delivers:
--   • assign_daily_missions_for_profile(profile_id) — assigns the
--     4-slot daily slate (1 Epic + 2 Common + 1 Rare) to a single
--     player. Also assigns the weekly mission if today is Monday
--     UTC. Idempotent within a single day — anti-repeat (3-day
--     window) plus per-call dedup means re-running mid-day won't
--     pile up duplicates, but it may add missions if the player
--     had < 4 slots filled previously.
--   • assign_daily_missions_for_all() — wrapper that loops over
--     every non-suspended, non-guest profile and calls the
--     per-profile function. This is what pg_cron invokes.
--   • Scheduled at 00:00 UTC daily so a player who logs in at any
--     time during the day finds their fresh slate already there.
--
-- The per-profile function is split out so:
--   • Phase 5's reroll_mission RPC can call into similar pick
--     logic for replacing a single slot.
--   • Phase 6 (frontend) can call ensure-have-missions on first
--     lobby render for new sign-ups, so they don't have to wait
--     for the next midnight tick.
--   • Operator can test on a single profile during Phase 8
--     dark-launch without recomputing the world.
--
-- Slot composition (locked by spec): 1 always-Epic + 3 from
-- Common/Rare pool with bias toward 2 Common + 1 Rare to match
-- the mockup. If the eligible pool of a rarity is empty, that
-- slot is skipped — better UX to deliver 3 missions than to
-- assign nothing.
--
-- Anti-repeat window: 3 days. A template assigned to a player
-- in the last 3 days is excluded from new picks. This is what
-- prevents "the same Play X matches mission every day" boredom.

-- ============================================================
-- Section 1: per-profile assignment function.
-- ============================================================
create or replace function public.assign_daily_missions_for_profile(
  p_profile_id uuid
)
returns int  -- count of missions assigned this call
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prof public.profiles;
  template_row public.mission_templates;
  baseline numeric;
  v_resolved_goal int;
  now_utc timestamptz := now();
  -- End-of-day in UTC: 00:00 of tomorrow UTC.
  day_end timestamptz := (current_date + interval '1 day')::timestamptz;
  -- End-of-ISO-week in UTC: 00:00 of next Monday.
  week_end timestamptz := (date_trunc('week', current_date) + interval '7 days')::timestamptz;
  is_monday_utc boolean := extract(isodow from current_date) = 1;
  -- The slot composition for daily missions.
  slot_rarities text[] := array['common', 'common', 'rare', 'epic'];
  picked_ids uuid[] := array[]::uuid[];
  picked_types text[] := array[]::text[];
  i int;
  assigned int := 0;
begin
  -- Load profile (must exist and be active).
  select * into prof
  from public.profiles
  where id = p_profile_id
    and not coalesce(is_suspended, false)
    and not coalesce(is_guest, false);
  if not found then
    return 0;
  end if;

  -- ─────────────────────────────────────────────────────────
  -- Daily slots
  -- ─────────────────────────────────────────────────────────
  for i in 1..array_length(slot_rarities, 1) loop
    -- How many active daily missions of this rarity does the
    -- player already have today? If they already have the
    -- target count, skip — this is what makes the function
    -- safe to re-run mid-day.
    perform 1
    from public.player_daily_missions pdm
    where pdm.profile_id = p_profile_id
      and pdm.rarity_slot = slot_rarities[i]
      and pdm.period = 'daily'
      and pdm.expires_at > now_utc
    limit 1;
    -- For Common we want 2 of them; for Rare and Epic just 1.
    -- The simplest predicate that matches: skip if the count
    -- of active slots of this rarity is already AT or ABOVE
    -- the target count.
    -- We approximate that by counting; small cost since the
    -- table is per-player tiny.
    if (
      select count(*) from public.player_daily_missions pdm
      where pdm.profile_id = p_profile_id
        and pdm.rarity_slot = slot_rarities[i]
        and pdm.period = 'daily'
        and pdm.expires_at > now_utc
    ) >= (case slot_rarities[i]
            when 'common' then 2
            when 'rare'   then 1
            when 'epic'   then 1
          end)
    then
      continue;
    end if;

    -- Pick an eligible template for this slot.
    select t.*
    into template_row
    from public.mission_templates t
    where t.enabled = true
      and t.period = 'daily'
      and t.rarity = slot_rarities[i]
      -- min_level / max_level eligibility
      and (
        t.eligibility->>'min_level' is null
        or (t.eligibility->>'min_level')::int <= prof.level
      )
      and (
        t.eligibility->>'max_level' is null
        or (t.eligibility->>'max_level')::int >= prof.level
      )
      -- requires_rated: only assign rated missions to players
      -- whose pvp_rating is set (indicates at least one online
      -- match played and an Elo assigned).
      and (
        not (t.eligibility ? 'requires_rated'
             and (t.eligibility->>'requires_rated')::boolean)
        or coalesce(prof.pvp_rating, 0) > 0
      )
      -- Anti-repeat: not assigned to this player in the last
      -- 3 days. Catches both yesterday's missions AND any
      -- partial re-runs of this assignment function.
      and not exists (
        select 1 from public.player_daily_missions pdm
        where pdm.profile_id = p_profile_id
          and pdm.mission_template_id = t.id
          and pdm.assigned_at > now_utc - interval '3 days'
      )
      -- Don't pick the same template twice in THIS call.
      and t.id <> all(picked_ids)
      -- Don't pick two templates of the same MISSION_TYPE in
      -- THIS call either — otherwise a Rare "XP push" + Epic
      -- "XP marathon" both feed xp_per_day, and completing one
      -- auto-progresses the other. Boring UX.
      and t.mission_type <> all(picked_types)
    order by random()
    limit 1;

    if template_row.id is null then
      -- No eligible template for this slot — skip rather than
      -- backfill with a different rarity. Operator should
      -- ensure the catalog has enough Common/Rare/Epic
      -- templates for every player's eligibility range.
      continue;
    end if;

    -- Resolve goal_value per resolution_mode.
    if template_row.resolution_mode = 'fixed' then
      v_resolved_goal := template_row.goal_value;
    else
      -- stretch: clamp(ceil(baseline_7d * stretch_factor), min, max)
      select pm.baseline_7d into baseline
      from public.player_metrics pm
      where pm.profile_id = p_profile_id
        and pm.metric_code = template_row.metric_code;

      baseline := coalesce(baseline, 0);
      v_resolved_goal := greatest(
        template_row.goal_min,
        least(
          template_row.goal_max,
          greatest(1, ceil(baseline * template_row.stretch_factor)::int)
        )
      );
    end if;

    -- Insert the assignment.
    insert into public.player_daily_missions
      (profile_id, mission_template_id, rarity_slot, resolved_goal,
       expires_at, period, assigned_at)
    values
      (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal,
       day_end, 'daily', now_utc);

    picked_ids := picked_ids || template_row.id;
    picked_types := picked_types || template_row.mission_type;
    assigned := assigned + 1;
  end loop;

  -- ─────────────────────────────────────────────────────────
  -- Weekly slot (only on Mondays UTC)
  -- ─────────────────────────────────────────────────────────
  if is_monday_utc then
    -- Same dedup: skip if a weekly mission is already active.
    if not exists (
      select 1 from public.player_daily_missions pdm
      where pdm.profile_id = p_profile_id
        and pdm.period = 'weekly'
        and pdm.expires_at > now_utc
    ) then
      select t.*
      into template_row
      from public.mission_templates t
      where t.enabled = true
        and t.period = 'weekly'
        and (
          t.eligibility->>'min_level' is null
          or (t.eligibility->>'min_level')::int <= prof.level
        )
        and (
          t.eligibility->>'max_level' is null
          or (t.eligibility->>'max_level')::int >= prof.level
        )
        and (
          not (t.eligibility ? 'requires_rated'
               and (t.eligibility->>'requires_rated')::boolean)
          or coalesce(prof.pvp_rating, 0) > 0
        )
      order by random()
      limit 1;

      if template_row.id is not null then
        if template_row.resolution_mode = 'fixed' then
          v_resolved_goal := template_row.goal_value;
        else
          select pm.baseline_7d into baseline
          from public.player_metrics pm
          where pm.profile_id = p_profile_id
            and pm.metric_code = template_row.metric_code;
          baseline := coalesce(baseline, 0);
          v_resolved_goal := greatest(
            template_row.goal_min,
            least(
              template_row.goal_max,
              greatest(1, ceil(baseline * template_row.stretch_factor)::int)
            )
          );
        end if;

        insert into public.player_daily_missions
          (profile_id, mission_template_id, rarity_slot, resolved_goal,
           expires_at, period, assigned_at)
        values
          (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal,
           week_end, 'weekly', now_utc);
        assigned := assigned + 1;
      end if;
    end if;
  end if;

  return assigned;
end;
$$;

comment on function public.assign_daily_missions_for_profile(uuid) is
  'Assigns the 4-slot daily mission slate (1 Epic + 2 Common + 1 Rare) plus the weekly mission on Mondays. Safe to re-run mid-day — already-active slots of each rarity are skipped. Returns the count of missions inserted this call.';

-- ============================================================
-- Section 2: all-profiles wrapper (what pg_cron invokes).
-- ============================================================
create or replace function public.assign_daily_missions_for_all()
returns int  -- total missions assigned across all profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prof_id uuid;
  total int := 0;
begin
  for prof_id in
    select id from public.profiles
    where not coalesce(is_suspended, false)
      and not coalesce(is_guest, false)
  loop
    total := total + public.assign_daily_missions_for_profile(prof_id);
  end loop;
  return total;
end;
$$;

comment on function public.assign_daily_missions_for_all() is
  'pg_cron entrypoint: loops over every active non-guest profile and assigns the daily/weekly mission slate. Returns total missions inserted.';

-- Grant execute to service_role for cron + admin-tooling use.
-- (Not granted to authenticated — players never call these
-- directly; the lobby will call assign_daily_missions_for_profile
-- as needed through a server-side RPC in Phase 6.)
grant execute on function public.assign_daily_missions_for_profile(uuid) to service_role;
grant execute on function public.assign_daily_missions_for_all() to service_role;

-- ============================================================
-- Section 3: pg_cron schedule.
--
-- Runs at 00:00 UTC daily so every player who logs in any time
-- during the day finds their fresh slate already there. Idempotent:
-- drop any prior named schedule before creating.
-- ============================================================
do $j$
begin
  perform cron.unschedule('daily-missions-assign');
exception when others then
  null;
end;
$j$;

select cron.schedule(
  'daily-missions-assign',
  '0 0 * * *',
  $cron$select public.assign_daily_missions_for_all()$cron$
);

-- ============================================================
-- Section 4: one-shot manual assign on apply so we have test
-- data to verify Phase 3 immediately. The cron will take over
-- from the next 00:00 UTC tick.
-- ============================================================
select public.assign_daily_missions_for_all();
