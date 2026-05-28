-- One-time backfill: promote every existing profile whose current xp
-- already qualifies for a higher level than profiles.level reflects.
--
-- The 20260620 trigger only fires when xp CHANGES, so players who
-- accumulated xp BEFORE the trigger landed are still frozen at
-- whatever level they had when their last xp update happened. This
-- block walks every profile, finds the highest qualifying level,
-- and promotes them in place — also crediting the level-up rewards
-- (reward_coins + reward_gems from level_configs) they would have
-- earned if the trigger had been live, with a wallet_transactions
-- row tagged source='level_reward' + metadata.source='backfill' for
-- audit clarity.
--
-- Also re-asserts the auto-promote trigger from 20260620 as a
-- belt-and-suspenders measure — if 20260620 wasn't applied yet,
-- this migration is still self-contained.

/* -------------------------------------------------------------------------- */
/* 1. Re-assert the auto-promote trigger (idempotent — same body as 20260620) */
/* -------------------------------------------------------------------------- */

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
  if new.xp <= coalesce(old.xp, 0) then
    return new;
  end if;

  select level into target_lvl
  from public.level_configs
  where is_enabled and xp_required <= new.xp
  order by level desc
  limit 1;

  if target_lvl is null or target_lvl <= coalesce(new.level, 1) then
    return new;
  end if;

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

  new.level := target_lvl;

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
        (new.id, 'coins', total_coins, coalesce(wallet_after.coins, 0),
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

/* -------------------------------------------------------------------------- */
/* 2. Backfill every profile whose current xp ALREADY qualifies for a higher  */
/*    level than profiles.level. Updates level directly (no xp change) so the */
/*    trigger above doesn't fire; we still want the level-up rewards, so this */
/*    block computes them inline (mirrors the trigger's reward math).         */
/* -------------------------------------------------------------------------- */

do $$
declare
  prof public.profiles;
  target_lvl int;
  total_coins int;
  total_gems int;
  lvl_row public.level_configs;
  wallet_after public.user_wallets;
  promoted_count int := 0;
  has_deleted_at boolean;
begin
  -- profiles.deleted_at exists on a clean replay (added by the
  -- 20260513 soft-delete migration) but was dropped out-of-band on
  -- environments that later switched to hard-delete. Probe for the
  -- column so this backfill runs whether or not it's present, instead
  -- of erroring with "column deleted_at does not exist" mid-chain.
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'deleted_at'
  ) into has_deleted_at;

  for prof in execute (
    case
      when has_deleted_at
        then 'select * from public.profiles where deleted_at is null'
        else 'select * from public.profiles'
    end
  )
  loop
    total_coins := 0;
    total_gems := 0;

    select level into target_lvl
    from public.level_configs
    where is_enabled and xp_required <= prof.xp
    order by level desc
    limit 1;

    if target_lvl is null or target_lvl <= prof.level then
      continue;
    end if;

    -- Sum rewards across every level gained — a player sitting on
    -- enough xp for level 7 but stuck at level 3 still gets the
    -- reward_coins / reward_gems from levels 4, 5, 6, 7.
    for lvl_row in
      select *
      from public.level_configs
      where is_enabled
        and level > prof.level
        and level <= target_lvl
      order by level asc
    loop
      total_coins := total_coins + coalesce(lvl_row.reward_coins, 0);
      total_gems := total_gems + coalesce(lvl_row.reward_gems, 0);
    end loop;

    -- Bump the level (the trigger doesn't fire because xp isn't
    -- being changed, only level).
    update public.profiles set level = target_lvl where id = prof.id;
    promoted_count := promoted_count + 1;

    if total_coins > 0 or total_gems > 0 then
      insert into public.user_wallets (profile_id)
      values (prof.id)
      on conflict (profile_id) do nothing;

      update public.user_wallets
         set coins = coins + total_coins,
             gems = gems + total_gems
       where profile_id = prof.id
      returning * into wallet_after;

      if total_coins > 0 then
        insert into public.wallet_transactions
          (profile_id, currency, amount, balance_after,
           source, reason, metadata, created_by)
        values
          (prof.id, 'coins', total_coins, coalesce(wallet_after.coins, 0),
           'level_reward',
           'Backfill level-up: ' || prof.level || ' → ' || target_lvl,
           jsonb_build_object(
             'from_level', prof.level,
             'to_level', target_lvl,
             'reward_gems', total_gems,
             'origin', 'backfill_20260621'
           ),
           prof.id);
      end if;
    end if;
  end loop;

  raise notice 'profiles_auto_promote_level backfill: promoted % profiles', promoted_count;
end;
$$;
