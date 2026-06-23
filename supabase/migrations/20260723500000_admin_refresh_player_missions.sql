-- BO testing helper: refresh a real player's daily missions on demand (instead
-- of waiting for the nightly assignment cron). Clears the player's CURRENT daily
-- missions and re-runs the assigner, so the operator can iterate on templates /
-- cashback / tiers and immediately see fresh missions.
--
-- Admin-gated via private.can_manage_config (same guard as every other BO write).
-- Unlike simulate_reset_today_missions (which only works on is_simulated test
-- profiles), this works on any real account, looked up by email. Weekly missions
-- are left intact; only the daily slots are refreshed. No wallet side effects --
-- it only deletes + recreates mission rows (claiming is what grants rewards).
create or replace function public.admin_refresh_player_missions(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_deleted int;
  v_assigned int;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select u.id into v_profile_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
  if v_profile_id is null then
    raise exception 'no_user_for_email';
  end if;

  with deleted as (
    delete from public.player_daily_missions
    where profile_id = v_profile_id and period = 'daily' and expires_at > now()
    returning 1
  )
  select count(*) into v_deleted from deleted;

  v_assigned := public.assign_daily_missions_for_profile(v_profile_id);

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'deleted', v_deleted,
    'assigned', v_assigned
  );
end;
$$;

grant execute on function public.admin_refresh_player_missions(text) to authenticated;
