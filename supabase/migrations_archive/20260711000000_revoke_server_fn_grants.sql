-- Security hardening (audit B-SEC-1): tighten over-broad EXECUTE grants on
-- server-only SECURITY DEFINER functions.
--
-- These functions are internally guarded (can_manage_config / owner checks /
-- self-scoped), so the broad grant was defense-in-depth surface, not a live
-- breach — EXCEPT the 4 heavy pg_cron maintenance functions, which any
-- authenticated user could call repeatedly as a DB-load DoS.
--
-- Safe-by-construction:
--  * 'anon' (truly unauthenticated) never legitimately calls ANY of these —
--    admins and guests both use the 'authenticated' role — so revoking from
--    anon only removes attack surface.
--  * From 'authenticated' we revoke ONLY the 4 functions that NO client calls
--    (verified by grepping every supabase.rpc() call site): they run solely via
--    pg_cron as the job owner, which is unaffected by these grants. The Back
--    Office (recompute_player_levels, assign_daily_missions_for_profile,
--    simulate_*, admin_*, set_active_podium) and players (abandon_stale_matches)
--    keep their 'authenticated' grant.
--
-- Dynamic so it matches whatever overload signatures exist (no hand-typed args).

do $$
declare
  r record;
  -- revoke from anon for all server-only functions
  anon_fns text[] := array[
    'recompute_daily_mission_metrics','assign_daily_missions_for_all','cleanup_stale_rows',
    'daily_streak_rollover','recompute_player_levels','assign_daily_missions_for_profile',
    'admin_adjust_wallet','admin_hard_delete_user','admin_upsert_currency_config',
    'admin_upsert_economy_grant','set_active_podium','abandon_stale_matches',
    'simulate_create_test_profile','simulate_set_metric','simulate_spawn_archetypes',
    'simulate_cleanup_all','simulate_reset_today_missions','simulate_list_test_profiles',
    'simulate_get_test_user_state'
  ];
  -- also revoke from authenticated: pure pg_cron functions no client calls
  cron_fns text[] := array[
    'recompute_daily_mission_metrics','assign_daily_missions_for_all',
    'cleanup_stale_rows','daily_streak_rollover'
  ];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(anon_fns)
  loop
    -- Must revoke from PUBLIC, not just anon: these functions carry the default
    -- GRANT EXECUTE TO PUBLIC, so anon/authenticated inherit EXECUTE via PUBLIC.
    -- The explicit authenticated/service_role grants survive, so the Back Office
    -- and cron keep access.
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    if r.proname = any(cron_fns) then
      -- Pure pg_cron functions: also drop the explicit authenticated grant, so
      -- only service_role/owner (the cron runner) can execute them.
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
    end if;
  end loop;
end $$;
