-- Atomic board purchase: checks unlock_level, debits gems, logs the
-- transaction, and inserts inventory in a single transaction so a
-- failure at any step rolls back the gem debit.

create or replace function public.purchase_board_with_gems(
  target_board_id text
)
returns public.user_wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  board_row public.board_theme_configs;
  player_level int;
  cost_gems int;
  wallet_row public.user_wallets;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into board_row from public.board_theme_configs where id = target_board_id;
  if not found then
    raise exception 'board_not_found';
  end if;
  if not board_row.is_enabled then
    raise exception 'board_disabled';
  end if;

  cost_gems := coalesce(board_row.price_gems, 0);
  if cost_gems <= 0 then
    raise exception 'board_not_purchasable';
  end if;

  select level into player_level from public.profiles where id = caller_id;
  if player_level is null then
    raise exception 'profile_not_found';
  end if;
  if player_level < board_row.unlock_level then
    raise exception 'level_too_low';
  end if;

  -- Already owned: short-circuit so a double-tap doesn't double-charge.
  if exists (
    select 1 from public.user_board_inventory
    where profile_id = caller_id and board_theme_id = target_board_id
  ) then
    raise exception 'already_owned';
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  update public.user_wallets
  set gems = gems - cost_gems
  where profile_id = caller_id
    and gems >= cost_gems
  returning * into wallet_row;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_gems';
  end if;

  insert into public.wallet_transactions (
    profile_id, currency, amount, balance_after, source, reason, metadata, created_by
  ) values (
    caller_id,
    'gems',
    -cost_gems,
    wallet_row.gems,
    'purchase',
    'Board purchase: ' || target_board_id,
    jsonb_build_object('board_theme_id', target_board_id),
    caller_id
  );

  insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
  values (caller_id, target_board_id, 'purchase', caller_id);

  return wallet_row;
end;
$$;

grant execute on function public.purchase_board_with_gems(text) to authenticated;

comment on function public.purchase_board_with_gems(text) is
  'Atomically purchases a board with gems. Checks unlock_level, debits gems, logs wallet_transactions, inserts user_board_inventory with source=purchase. Returns the updated wallet row. Raises: not_authenticated, board_not_found, board_disabled, board_not_purchasable, profile_not_found, level_too_low, already_owned, insufficient_gems.';
