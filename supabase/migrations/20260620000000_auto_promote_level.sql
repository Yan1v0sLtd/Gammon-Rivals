-- Auto-promote profiles.level when xp crosses a level_configs threshold.
--
-- Before this migration, every XP source (claim_daily_bonus, finish_match,
-- spin_wheel, BO admin grants) only added to profiles.xp and left
-- profiles.level untouched. A player could earn 2 000 XP from the wheel
-- and stay frozen at LEVEL 3 with a 540 / 520 XP progress bar, because no
-- code path ever recomputed level from xp.
--
-- The fix lives in a BEFORE UPDATE trigger on profiles.xp:
--   - When xp increases, find the highest enabled level whose xp_required
--     is met by the new xp value.
--   - If that level > the current level, mutate NEW.level so the same
--     UPDATE that bumped xp now also writes the new level.
--   - Sum reward_coins / reward_gems across every level gained and credit
--     them to user_wallets via a separate UPDATE inside the trigger, then
--     log a wallet_transactions row with source = 'level_reward' so the BO
--     audit shows the auto-grant.
--
-- The trigger is BEFORE UPDATE so NEW.level lands in the row write —
-- doing a second UPDATE inside the trigger would recurse. The level
-- column is not touched by the trigger when xp didn't actually change
-- (WHEN clause on the trigger), so manual level edits in the BO are
-- never overridden.
--
-- All three existing RPCs (claim_daily_bonus, finish_match, spin_wheel)
-- already do an `update public.profiles set xp = xp + …` with a
-- `returning * into profile_row` — they'll automatically pick up the
-- promoted level value in their response payloads.

create or replace function public.profiles_auto_promote_level()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_lvl int;
  total_coins int := 0;
  total_gems int := 0;
  lvl_row public.level_configs;
  wallet_after public.user_wallets;
begin
  -- Only act when xp ACTUALLY went up. The WHEN clause on the trigger
  -- already filters non-xp-only updates, but a guard here keeps this
  -- function safe to call from a hypothetical future direct path.
  if new.xp <= coalesce(old.xp, 0) then
    return new;
  end if;

  -- Find the highest enabled level the new xp now qualifies for.
  select level into target_lvl
  from public.level_configs
  where is_enabled and xp_required <= new.xp
  order by level desc
  limit 1;

  -- No qualifying level, or no promotion past the current one.
  if target_lvl is null or target_lvl <= coalesce(new.level, 1) then
    return new;
  end if;

  -- Sum the reward_coins / reward_gems of every level the player
  -- crossed in this single xp grant (so a "+5000 XP" prize that jumps
  -- the player from lvl 3 → lvl 7 still pays out levels 4, 5, 6, 7).
  for lvl_row in
    select *
    from public.level_configs
    where is_enabled
      and level > coalesce(new.level, 1)
      and level <= target_lvl
    order by level asc
  loop
    total_coins := total_coins + coalesce(lvl_row.reward_coins, 0);
    total_gems := total_gems + coalesce(lvl_row.reward_gems, 0);
  end loop;

  -- Mutate the row WRITTEN by the triggering UPDATE so the caller's
  -- `returning *` sees the new level. No second UPDATE here — that
  -- would recurse through this same trigger.
  new.level := target_lvl;

  -- Side-effect: credit any level-up rewards to the wallet. Use a
  -- separate UPDATE (not RETURNING NEW) because we're in a BEFORE
  -- trigger and need to read the post-update wallet for the ledger.
  if total_coins > 0 or total_gems > 0 then
    insert into public.user_wallets (profile_id)
    values (new.id)
    on conflict (profile_id) do nothing;

    update public.user_wallets
       set coins = coins + total_coins,
           gems = gems + total_gems
     where profile_id = new.id
    returning * into wallet_after;

    if total_coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after,
         source, reason, metadata, created_by)
      values
        (new.id,
         'coins',
         total_coins,
         coalesce(wallet_after.coins, 0),
         'level_reward',
         'Level-up reward: ' || coalesce(old.level, 1) || ' → ' || target_lvl,
         jsonb_build_object(
           'from_level', coalesce(old.level, 1),
           'to_level', target_lvl,
           'reward_gems', total_gems
         ),
         new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_auto_promote_level on public.profiles;
create trigger profiles_auto_promote_level
  before update of xp on public.profiles
  for each row
  when (new.xp is distinct from old.xp)
  execute function public.profiles_auto_promote_level();

comment on function public.profiles_auto_promote_level() is
  'Before-update trigger that promotes profiles.level + grants level_configs.reward_coins / reward_gems when xp crosses a level threshold. Fires only when xp changes. Mutates NEW.level so the original UPDATE write carries the new level, avoiding recursion.';
