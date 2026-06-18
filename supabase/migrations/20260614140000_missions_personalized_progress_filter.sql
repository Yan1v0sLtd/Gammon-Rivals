-- Personalized missions — integration step 2b: per-mission focus-tier progress.
--
-- A personalized mission carries player_daily_missions.focus_tier (a
-- table_configs id like 'difficulty-advanced'); it must progress ONLY on
-- matches at that tier. Two additive changes:
--   1. the match→missions trigger now puts the authoritative table_config_id
--      in the event context (alongside the existing mode-derived difficulty_id,
--      which is lossy for Expert/Grand-Master). Legacy param-filtered templates
--      that key on difficulty_id keep working.
--   2. progress_mission honours focus_tier: a row with focus_tier set only
--      advances when the event's table_config_id matches. Rows with
--      focus_tier = NULL (every legacy mission) are unaffected.

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

  if p_event_id is not null then
    begin
      insert into public.mission_progress_events
        (event_id, profile_id, metric_code, delta)
      values (p_event_id, p_profile_id, p_metric_code, p_delta);
    exception when unique_violation then
      return;
    end;
  end if;

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
    and (mt.params = '{}'::jsonb or mt.params <@ p_context)
    -- personalized missions count only their focus tier; NULL = no filter (legacy).
    and (pdm.focus_tier is null or pdm.focus_tier = (p_context ->> 'table_config_id'));
end;
$$;

comment on function public.progress_mission(uuid, text, int, text, jsonb) is
  'Incremental progress for any active mission whose metric matches, whose template params are contained in the event context, and whose focus_tier (if set) matches the event table_config_id. Idempotent via event_id.';

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
  if OLD.finished_at is not null or NEW.finished_at is null then
    return NEW;
  end if;

  owner_won := NEW.winner is not null and NEW.winner = NEW.owner_color;
  opp_won   := NEW.winner is not null and NEW.winner <> NEW.owner_color;

  -- Authoritative tier = table_config_id; fall back to the mode mapping only
  -- when no tier is set (legacy hotseat/online without a difficulty config).
  difficulty_id := case
    when NEW.table_config_id like 'difficulty-%' then replace(NEW.table_config_id, 'difficulty-', '')
    when NEW.mode = 'ai-easy'   then 'beginner'
    when NEW.mode = 'ai-medium' then 'advanced'
    when NEW.mode = 'ai-hard'   then 'pro'
    else NEW.mode
  end;

  -- table_config_id is the key personalized focus matches on.
  ctx := jsonb_build_object('mode', NEW.mode, 'difficulty_id', difficulty_id, 'table_config_id', NEW.table_config_id);

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
