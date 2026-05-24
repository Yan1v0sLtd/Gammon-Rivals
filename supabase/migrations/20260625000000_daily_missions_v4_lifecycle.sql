-- Daily Missions v4 — lifecycle RPCs + event-hook triggers.
--
-- Phase 4 per docs/specs/daily-missions.md.
--
-- Delivers:
--   • mission_progress_events    — idempotency log
--   • progress_mission(...)      — INCREMENTAL progress update for
--                                  active missions matching a metric.
--                                  Filters templates by params (jsonb
--                                  containment) so a mission with
--                                  params {"difficulty_id":"pro"}
--                                  only progresses on events whose
--                                  context contains that key.
--   • progress_mission_reset(..) — zeros progress on un-completed
--                                  missions for a metric. Used by
--                                  win_streak when a match is LOST.
--   • claim_mission(mission_id)  — credits rewards + MP, marks
--                                  claimed_at, bumps streak if the
--                                  full daily slate is now claimed.
--
-- Triggers wired (Phase 4's "event hooks" without editing existing
-- RPCs):
--   • wallet_transactions AFTER INSERT
--       → wheel_spins_per_day        (source=wheel_spin)
--       → coins_wagered_per_day      (source=entry_fee)
--       → coins_won_net_per_day      (source=match_reward, amount>0)
--       → gems_spent_per_day         (source IN purchase, mission_reroll_fee
--                                     and currency=gems, amount<0)
--   • matches AFTER UPDATE of finished_at (null→not-null)
--       → matches_per_day for owner + opponent
--       → win_streak  (increment on win, reset on loss)
--       → ranked_wins_per_week (mode='online' only)
--   • profiles AFTER UPDATE of xp
--       → xp_per_day  (delta on XP gain)
--   • profiles AFTER UPDATE of level
--       → levels_per_week  (delta on level gain)
--
-- Same-day idempotency comes from the mission_progress_events table:
-- every progress call passes an event_id derived from the source row
-- (e.g. "wt:<uuid>" for a wallet_transaction). Duplicate firings of
-- the same event are caught at the insert-into-idempotency-log step
-- via unique_violation.

-- ============================================================
-- Section 1: idempotency log.
-- ============================================================
create table public.mission_progress_events (
  event_id text primary key,
  profile_id uuid not null,
  metric_code text not null,
  delta int not null,
  processed_at timestamptz not null default now()
);

create index mission_progress_events_profile_idx
  on public.mission_progress_events (profile_id, processed_at desc);

-- RLS: admin-read only (this is an internal audit log; players
-- never need to see their own progress events).
alter table public.mission_progress_events enable row level security;
create policy mission_progress_events_admin_read
  on public.mission_progress_events for select
  using (private.is_admin(auth.uid()));

-- ============================================================
-- Section 2: progress_mission(...) — incremental.
-- ============================================================
create or replace function public.progress_mission(
  p_profile_id uuid,
  p_metric_code text,
  p_delta int,
  p_event_id text default null,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_delta <= 0 then return; end if;

  -- Idempotency: if event_id already processed, no-op.
  if p_event_id is not null then
    begin
      insert into public.mission_progress_events
        (event_id, profile_id, metric_code, delta)
      values (p_event_id, p_profile_id, p_metric_code, p_delta);
    exception when unique_violation then
      return;
    end;
  end if;

  -- Update active missions matching the metric AND whose template
  -- params are a subset of the event context (jsonb <@). Templates
  -- with params={} are trivially contained and always match.
  update public.player_daily_missions pdm
  set
    progress = least(pdm.progress + p_delta, pdm.resolved_goal),
    completed_at = case
      when pdm.progress + p_delta >= pdm.resolved_goal
        and pdm.completed_at is null
      then now()
      else pdm.completed_at
    end
  from public.mission_templates mt
  where mt.id = pdm.mission_template_id
    and pdm.profile_id = p_profile_id
    and mt.metric_code = p_metric_code
    and pdm.expires_at > now()
    and pdm.claimed_at is null
    and (mt.params = '{}'::jsonb or mt.params <@ p_context);
end;
$$;

comment on function public.progress_mission(uuid, text, int, text, jsonb) is
  'Incremental progress update for any active mission whose metric matches and whose template params are contained in the event context. Idempotent via event_id.';

-- ============================================================
-- Section 3: progress_mission_reset(...) — zero progress on
-- non-completed missions for a metric. Used when a streak breaks.
-- ============================================================
create or replace function public.progress_mission_reset(
  p_profile_id uuid,
  p_metric_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.player_daily_missions pdm
  set progress = 0
  from public.mission_templates mt
  where mt.id = pdm.mission_template_id
    and pdm.profile_id = p_profile_id
    and mt.metric_code = p_metric_code
    and pdm.expires_at > now()
    and pdm.completed_at is null  -- never un-complete a finished mission
    and pdm.claimed_at is null;
end;
$$;

comment on function public.progress_mission_reset(uuid, text) is
  'Zeros progress on un-completed missions for a metric. Used by the matches trigger when a player loses a match (resets active win_streak missions). Already-completed missions are left alone.';

-- ============================================================
-- Section 4: claim_mission(mission_id)
-- ============================================================
create or replace function public.claim_mission(
  p_mission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  pdm public.player_daily_missions;
  mt public.mission_templates;
  reward record;
  wallet_row public.user_wallets;
  profile_row public.profiles;
  total_coins int := 0;
  total_gems int := 0;
  total_xp int := 0;
  mp_award int := 0;
  week_key text := to_char(now(), 'IYYY-"W"IW');
  unclaimed_today int;
  prior_streak int;
  prior_last_date date;
  new_streak int;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  -- Lock the mission row to prevent double-claim.
  select * into pdm from public.player_daily_missions
  where id = p_mission_id and profile_id = caller_id
  for update;

  if not found then raise exception 'mission_not_found'; end if;
  if pdm.completed_at is null then raise exception 'mission_not_complete'; end if;
  if pdm.claimed_at is not null then raise exception 'already_claimed'; end if;
  if pdm.expires_at <= now() then raise exception 'mission_expired'; end if;

  select * into mt from public.mission_templates where id = pdm.mission_template_id;

  -- Walk the reward bundle.
  for reward in
    select reward_kind, currency_code, item_table, item_id, amount
    from public.mission_rewards
    where mission_id = pdm.mission_template_id
    order by display_order
  loop
    if reward.reward_kind = 'currency' then
      case reward.currency_code
        when 'coins' then total_coins := total_coins + reward.amount;
        when 'gems'  then total_gems  := total_gems  + reward.amount;
        when 'xp'    then total_xp    := total_xp    + reward.amount;
        else null;  -- unknown currency: silently skip
      end case;
    elsif reward.reward_kind = 'item' then
      -- Item dispatch: known types route to their dedicated
      -- inventory table; unknown types go to the generic
      -- user_inventory ledger.
      if reward.item_table = 'board_theme_configs' then
        insert into public.user_board_inventory
          (profile_id, board_theme_id, source, granted_by)
        values
          (caller_id, reward.item_id, 'mission_reward', caller_id)
        on conflict (profile_id, board_theme_id) do nothing;
      else
        insert into public.user_inventory
          (profile_id, item_table, item_id, source, source_ref_id)
        values
          (caller_id, reward.item_table, reward.item_id,
           'mission_reward', pdm.mission_template_id::text)
        on conflict (profile_id, item_table, item_id) do nothing;
      end if;
    end if;
  end loop;

  -- Ensure wallet row exists.
  insert into public.user_wallets (profile_id) values (caller_id)
  on conflict (profile_id) do nothing;

  -- Credit wallet currencies + log transactions.
  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins, gems = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;

    if total_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'coins', total_coins, wallet_row.coins, 'mission_reward',
         'Mission: ' || mt.title,
         jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
         caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (caller_id, 'gems', total_gems, wallet_row.gems, 'mission_reward',
         'Mission: ' || mt.title,
         jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
         caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  -- Credit XP — fires the existing auto-promote-level trigger
  -- automatically, so this also lights up levels_per_week missions
  -- if the player happens to level up.
  if total_xp > 0 then
    update public.profiles set xp = xp + total_xp where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  -- Award Mission Points to the weekly pass.
  mp_award := mt.mission_points;
  if mp_award > 0 then
    insert into public.player_weekly_pass (profile_id, week_key, mp_earned)
    values (caller_id, week_key, mp_award)
    on conflict (profile_id, week_key) do update set
      mp_earned = public.player_weekly_pass.mp_earned + excluded.mp_earned,
      updated_at = now();
  end if;

  -- Mark this mission as claimed.
  update public.player_daily_missions set claimed_at = now() where id = p_mission_id;

  -- Slate-complete check → streak bump.
  -- If after this claim every daily mission today is claimed,
  -- increment the player's daily-completion streak.
  select count(*) into unclaimed_today
  from public.player_daily_missions
  where profile_id = caller_id
    and period = 'daily'
    and expires_at > now()
    and claimed_at is null;

  if unclaimed_today = 0 then
    select current_streak_days, last_complete_date
      into prior_streak, prior_last_date
    from public.player_streak
    where profile_id = caller_id;

    if prior_last_date = current_date then
      -- Already counted today (defensive — shouldn't happen).
      new_streak := coalesce(prior_streak, 1);
    elsif prior_last_date = current_date - 1 then
      new_streak := coalesce(prior_streak, 0) + 1;
    else
      new_streak := 1;  -- gap (or first ever)
    end if;

    insert into public.player_streak
      (profile_id, current_streak_days, last_complete_date)
    values
      (caller_id, new_streak, current_date)
    on conflict (profile_id) do update set
      current_streak_days = excluded.current_streak_days,
      last_complete_date  = excluded.last_complete_date,
      updated_at = now();
  end if;

  -- Drive the meta-mission "Complete N other daily missions" by
  -- counting THIS claim as a missions_claimed event. progress_mission
  -- skips already-claimed missions, so the just-claimed row itself
  -- won't be re-incremented.
  perform public.progress_mission(
    caller_id,
    'missions_claimed_per_day',
    1,
    'claim:' || p_mission_id::text
  );

  return jsonb_build_object(
    'mission_id', p_mission_id,
    'credited_coins', total_coins,
    'credited_gems', total_gems,
    'credited_xp', total_xp,
    'mp_awarded', mp_award,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level),
    'streak_days', coalesce(new_streak, prior_streak),
    'slate_complete', unclaimed_today = 0
  );
end;
$$;

grant execute on function public.claim_mission(uuid) to authenticated;

comment on function public.claim_mission(uuid) is
  'Atomic mission claim. Validates ownership + completion + expiry, credits the reward bundle (currencies → wallet + wallet_transactions; items → user_board_inventory or user_inventory), awards Mission Points to the weekly pass, bumps the daily-completion streak if the full slate is now claimed, and fires a meta-mission progress event. Raises: not_authenticated, mission_not_found, mission_not_complete, already_claimed, mission_expired.';

-- ============================================================
-- Section 5: trigger — wallet_transactions → progress_mission
-- ============================================================
create or replace function public.wallet_transactions_progress_missions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Coin sources.
  if NEW.currency = 'coins' then
    if NEW.source = 'wheel_spin' then
      perform public.progress_mission(
        NEW.profile_id, 'wheel_spins_per_day', 1, 'wt:' || NEW.id::text);
    elsif NEW.source = 'entry_fee' then
      perform public.progress_mission(
        NEW.profile_id, 'coins_wagered_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
    elsif NEW.source = 'match_reward' and NEW.amount > 0 then
      perform public.progress_mission(
        NEW.profile_id, 'coins_won_net_per_day', NEW.amount, 'wt:' || NEW.id::text);
    end if;
  end if;

  -- Gem sinks.
  if NEW.currency = 'gems' and NEW.amount < 0
     and NEW.source in ('purchase', 'mission_reroll_fee') then
    perform public.progress_mission(
      NEW.profile_id, 'gems_spent_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
  end if;

  return NEW;
end;
$$;

drop trigger if exists wallet_transactions_progress_missions_trg on public.wallet_transactions;
create trigger wallet_transactions_progress_missions_trg
  after insert on public.wallet_transactions
  for each row execute function public.wallet_transactions_progress_missions();

-- ============================================================
-- Section 6: trigger — matches finished_at null→value
-- ============================================================
create or replace function public.matches_progress_missions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_won boolean;
  opp_won boolean;
  ctx jsonb;
  difficulty_id text;
begin
  -- Only fire on the null→not-null finished_at transition.
  if OLD.finished_at is not null or NEW.finished_at is null then
    return NEW;
  end if;

  owner_won := NEW.winner is not null and NEW.winner = NEW.owner_color;
  opp_won   := NEW.winner is not null and NEW.winner <> NEW.owner_color;

  -- Map mode → difficulty_id so "play X Pro matches" templates
  -- (params={"difficulty_id":"pro"}) can match. Operator can
  -- author additional mode mappings via BO later.
  difficulty_id := case NEW.mode
    when 'ai-easy'   then 'beginner'
    when 'ai-medium' then 'advanced'
    when 'ai-hard'   then 'pro'
    else NEW.mode
  end;

  ctx := jsonb_build_object('mode', NEW.mode, 'difficulty_id', difficulty_id);

  -- ── matches_per_day for owner
  if NEW.owner_id is not null then
    perform public.progress_mission(
      NEW.owner_id, 'matches_per_day', 1,
      'match:' || NEW.id::text || ':owner', ctx);

    if owner_won then
      perform public.progress_mission(
        NEW.owner_id, 'win_streak', 1,
        'match:' || NEW.id::text || ':owner:win');
    elsif opp_won then
      perform public.progress_mission_reset(NEW.owner_id, 'win_streak');
    end if;
  end if;

  -- ── matches_per_day for opponent (PvP only)
  if NEW.opponent_id is not null then
    perform public.progress_mission(
      NEW.opponent_id, 'matches_per_day', 1,
      'match:' || NEW.id::text || ':opp', ctx);

    if opp_won then
      perform public.progress_mission(
        NEW.opponent_id, 'win_streak', 1,
        'match:' || NEW.id::text || ':opp:win');
    elsif owner_won then
      perform public.progress_mission_reset(NEW.opponent_id, 'win_streak');
    end if;
  end if;

  -- ── ranked_wins_per_week (online mode only)
  if NEW.mode = 'online' then
    if owner_won and NEW.owner_id is not null then
      perform public.progress_mission(
        NEW.owner_id, 'ranked_wins_per_week', 1,
        'match:' || NEW.id::text || ':rwin:owner');
    elsif opp_won and NEW.opponent_id is not null then
      perform public.progress_mission(
        NEW.opponent_id, 'ranked_wins_per_week', 1,
        'match:' || NEW.id::text || ':rwin:opp');
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists matches_progress_missions_trg on public.matches;
create trigger matches_progress_missions_trg
  after update of finished_at on public.matches
  for each row execute function public.matches_progress_missions();

-- ============================================================
-- Section 7: triggers — profiles xp / level
-- ============================================================
create or replace function public.profiles_progress_xp_missions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delta int;
begin
  delta := coalesce(NEW.xp, 0) - coalesce(OLD.xp, 0);
  if delta > 0 then
    perform public.progress_mission(
      NEW.id, 'xp_per_day', delta,
      'xp:' || NEW.id::text || ':' || NEW.xp::text);
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_progress_xp_missions_trg on public.profiles;
create trigger profiles_progress_xp_missions_trg
  after update of xp on public.profiles
  for each row execute function public.profiles_progress_xp_missions();

create or replace function public.profiles_progress_level_missions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delta int;
begin
  delta := coalesce(NEW.level, 0) - coalesce(OLD.level, 0);
  if delta > 0 then
    perform public.progress_mission(
      NEW.id, 'levels_per_week', delta,
      'level:' || NEW.id::text || ':' || NEW.level::text);
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_progress_level_missions_trg on public.profiles;
create trigger profiles_progress_level_missions_trg
  after update of level on public.profiles
  for each row execute function public.profiles_progress_level_missions();
