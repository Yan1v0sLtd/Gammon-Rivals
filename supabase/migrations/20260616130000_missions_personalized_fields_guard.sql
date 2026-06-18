-- Integrity guard for the personalized snapshot columns.
-- focus_tier + reward_coins are meaningful ONLY on personalized missions; the
-- reroll path (and any row-reusing writer) was leaving them stale when a row
-- moved off the personalized template, which made claim_mission pay the stale
-- snapshot and progress_mission filter to the stale tier. Enforce the invariant
-- by construction: a BEFORE trigger nulls both columns on any row whose template
-- isn't personalized. Then clean up rows already corrupted.

create or replace function public.enforce_personalized_mission_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mode text;
begin
  select resolution_mode into v_mode from public.mission_templates where id = NEW.mission_template_id;
  if v_mode is distinct from 'personalized' then
    NEW.focus_tier := null;
    NEW.reward_coins := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists player_daily_missions_personalized_guard on public.player_daily_missions;
create trigger player_daily_missions_personalized_guard
  before insert or update on public.player_daily_missions
  for each row execute function public.enforce_personalized_mission_fields();

-- one-time cleanup: clear stale personalized fields off non-personalized rows
update public.player_daily_missions pdm
set focus_tier = null, reward_coins = null
from public.mission_templates mt
where mt.id = pdm.mission_template_id
  and mt.resolution_mode <> 'personalized'
  and (pdm.focus_tier is not null or pdm.reward_coins is not null);
