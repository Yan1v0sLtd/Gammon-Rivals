-- Recompute every player's level against the CURRENT level_configs
-- curve.
--
-- Why this exists: profiles_auto_promote_level (20260620 / 20260621)
-- is a `before update of xp` trigger — it only fires when a player
-- EARNS xp. Editing the curve in the BO writes to level_configs but
-- touches no profiles row, so every existing player stays frozen at
-- their old level until their next xp gain. After a curve retune that
-- lowered early thresholds, players end up under-leveled with a broken
-- XP bar (e.g. "655 / 268 XP" at level 4 — already past level 5's gate
-- but still shown as 4).
--
-- Policy: PROMOTE-ONLY, NO REWARDS.
--   - Promote-only: a player is bumped UP to the highest level their xp
--     now qualifies for, but never demoted. Dropping a player's level
--     on a retune feels punishing and would risk double-granting
--     rewards if they later re-promote across the same levels.
--   - No rewards: this is a level-ALIGNMENT pass, not an xp event. We
--     don't inject coins/gems (which would flood every player at once
--     if you lowered thresholds during tuning). The live trigger still
--     grants rewards normally as players earn xp going forward.
--
-- Implemented as a single set-based UPDATE so it stays fast even with a
-- large profiles table (no per-row loop). Admin-gated. Returns the
-- number of players promoted.

create or replace function public.recompute_player_levels()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  -- Mutates every profile, so restrict to config managers. auth.uid()
  -- resolves to the caller's JWT even inside SECURITY DEFINER, so this
  -- correctly gates BO RPC calls.
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized to recompute player levels';
  end if;

  -- profiles has no soft-delete column (hard-delete removes rows
  -- outright), so there's nothing to filter out here. Mirrors the
  -- auto-promote trigger, which also keys purely off xp.
  with target as (
    select pr.id, max(lc.level) as target_lvl
    from public.profiles pr
    join public.level_configs lc
      on lc.is_enabled and lc.xp_required <= pr.xp
    group by pr.id
  )
  update public.profiles p
  set level = t.target_lvl
  from target t
  where p.id = t.id
    and t.target_lvl > p.level;   -- promote-only

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.recompute_player_levels() from public;
grant execute on function public.recompute_player_levels() to authenticated;

comment on function public.recompute_player_levels() is
  'Promote-only level alignment: bumps each non-deleted profile UP to the highest enabled level its xp qualifies for under the current level_configs curve. Never demotes, never grants rewards. Admin-only. Returns count promoted. Call after a curve change so existing players are not left frozen at a stale level.';
