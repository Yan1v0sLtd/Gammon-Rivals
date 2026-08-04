-- Hard delete a user from auth.users + cascade everything else.
--
-- Why this exists: the Back Office soft-delete leaves the auth.users
-- row in place (and the profile + all related player_* / user_* /
-- match data via cascade). For test/dev workflows the operator
-- creates new shell guest users on every session, and those rows pile
-- up. Soft-deleted accounts aren't removed from auth, so the auth.users
-- table keeps growing and the same anonymous identity can't be
-- re-created cleanly.
--
-- This RPC deletes the auth.users row directly. The FK web is set up
-- so a delete on auth.users cascades through:
--   auth.users → public.profiles (CASCADE)
--     → admin_roles, matchmaking_queue, mission_rerolls,
--       player_daily_missions, player_metric_tiers, player_metrics,
--       player_streak, player_weekly_pass, purchases,
--       user_board_inventory, user_daily_bonuses, user_inventory,
--       user_wallets, user_wheel_spins, user_xp_boosts,
--       wallet_transactions (all CASCADE)
--     → board_theme_configs.updated_by, admin_audit_log.actor_profile_id,
--       admin_email_allowlist.created_by, level_configs.updated_by,
--       shop_items.updated_by, daily_bonus_configs.updated_by,
--       table_configs.updated_by, user_board_inventory.granted_by,
--       wallet_transactions.created_by (all SET NULL — fine, audit
--       trail keeps the action but loses the actor name)
--   auth.identities, auth.sessions, auth.mfa_factors, etc. (all CASCADE)
--
-- The only non-CASCADE FK is matches.opponent_id (NO ACTION) — would
-- block the delete if the target user was someone's opponent in a
-- still-finished match. We NULL it out first so the cascade works.
--
-- Guarded so only owner/admin can call it, and you can never delete
-- yourself by accident.

create or replace function public.admin_hard_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Allow owner OR admin (NOT support/viewer). Hard delete is
  -- irreversible — keep the gate tight.
  if not exists (
    select 1 from public.admin_roles
    where profile_id = caller_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'admin_required';
  end if;

  if target_id = caller_id then
    raise exception 'cannot_delete_self';
  end if;

  -- matches.opponent_id is the only FK pointing at profiles with
  -- ON DELETE NO ACTION; pre-null it so the auth.users delete can
  -- cascade through profiles without tripping the constraint.
  update public.matches
  set opponent_id = null
  where opponent_id = target_id;

  delete from auth.users where id = target_id;
end;
$$;

grant execute on function public.admin_hard_delete_user(uuid) to authenticated;

comment on function public.admin_hard_delete_user(uuid) is
  'Hard-delete a user. SECURITY DEFINER, owner/admin only, cannot self-delete. Nulls matches.opponent_id then deletes auth.users (cascades to profiles + all player_* / user_* tables). Used by the Back Office to purge test/shell users that pile up during dev. Raises: not_authenticated, admin_required, cannot_delete_self.';
