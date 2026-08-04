-- Economy grants — a configurable, extensible system for granting
-- coins/gems to a player when something happens ("taps").
--
-- Before this, a new player's starting balance was hardcoded as the
-- user_wallets column default (0). This generalizes it: the "signup"
-- grant is just one rule in a catalog the Back Office can edit, and
-- new taps (link Google, refer a friend, comeback bonus, …) are added
-- by inserting a row + firing one server-side call — no schema change.
--
-- Three pieces:
--   1. economy_grants   — the catalog of rules (BO-editable).
--   2. player_grants    — ledger of who received what (one-time guard
--                         + audit trail).
--   3. apply_economy_grant(profile_id, trigger_key) — the single
--      reusable primitive every tap calls. SECURITY DEFINER, and
--      intentionally NOT granted to client roles so players can't
--      farm grants by calling it directly. Only server-side code
--      (triggers, other definer functions) invokes it.

/* -------------------------------------------------------------------------- */
/* 1. Catalog of grant rules                                                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.economy_grants (
  trigger_key text primary key check (trigger_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  description text not null default '',
  coins int not null default 0 check (coins >= 0),
  gems int not null default 0 check (gems >= 0),
  one_time boolean not null default true,   -- can a player receive it more than once?
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.economy_grants is
  'Catalog of coin/gem grant rules keyed by trigger (signup, link_google, refer_friend, …). The Back Office edits these; apply_economy_grant() consumes them. one_time gates whether a player can receive the grant more than once.';

drop trigger if exists economy_grants_updated_at on public.economy_grants;
create trigger economy_grants_updated_at
  before update on public.economy_grants
  for each row execute function public.set_updated_at();

alter table public.economy_grants enable row level security;

-- Read for everyone (the lobby may want to surface "link Google for
-- +N coins" copy). Writes go through admin_upsert_economy_grant only.
drop policy if exists "economy_grants_read_all" on public.economy_grants;
create policy "economy_grants_read_all"
  on public.economy_grants for select
  to anon, authenticated
  using (true);

drop trigger if exists economy_grants_audit_log on public.economy_grants;
create trigger economy_grants_audit_log
  after insert or update or delete on public.economy_grants
  for each row execute function private.log_admin_config_change();

/* -------------------------------------------------------------------------- */
/* 2. Ledger — who received which grant                                       */
/* -------------------------------------------------------------------------- */

create table if not exists public.player_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  trigger_key text not null references public.economy_grants(trigger_key) on delete cascade,
  coins int not null default 0,
  gems int not null default 0,
  granted_at timestamptz not null default now()
);

-- Fast "did this player already get grant X?" lookups for the
-- one-time guard in apply_economy_grant.
create index if not exists player_grants_profile_trigger_idx
  on public.player_grants (profile_id, trigger_key);

alter table public.player_grants enable row level security;

-- A player may read their own grant history; admins read all. No
-- client write policy — only apply_economy_grant (definer) writes here.
drop policy if exists "player_grants_select_own_or_admin" on public.player_grants;
create policy "player_grants_select_own_or_admin"
  on public.player_grants for select
  using (profile_id = auth.uid() or private.is_admin(auth.uid()));

/* -------------------------------------------------------------------------- */
/* 3. The reusable grant primitive                                            */
/* -------------------------------------------------------------------------- */

create or replace function public.apply_economy_grant(
  p_profile_id uuid,
  p_trigger_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.economy_grants;
  wallet_after public.user_wallets;
begin
  -- Enabled rule for this trigger, or nothing to do.
  select * into rule
  from public.economy_grants
  where trigger_key = p_trigger_key and is_enabled;
  if not found then
    return;
  end if;

  -- One-time guard: skip if the player already received it.
  if rule.one_time and exists (
    select 1 from public.player_grants
    where profile_id = p_profile_id and trigger_key = p_trigger_key
  ) then
    return;
  end if;

  -- Credit the wallet (ensure the row exists first).
  if rule.coins > 0 or rule.gems > 0 then
    insert into public.user_wallets (profile_id)
    values (p_profile_id)
    on conflict (profile_id) do nothing;

    update public.user_wallets
       set coins = coins + rule.coins,
           gems  = gems  + rule.gems
     where profile_id = p_profile_id
    returning * into wallet_after;

    -- One ledger txn per currency actually granted, tagged so the
    -- BO/analytics can attribute it to the trigger. created_by is
    -- null: a grant is a system action, not an admin's.
    if rule.coins > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (p_profile_id, 'coins', rule.coins, coalesce(wallet_after.coins, 0),
         'system', rule.display_name,
         jsonb_build_object('grant_trigger', p_trigger_key), null);
    end if;
    if rule.gems > 0 then
      insert into public.wallet_transactions
        (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values
        (p_profile_id, 'gems', rule.gems, coalesce(wallet_after.gems, 0),
         'system', rule.display_name,
         jsonb_build_object('grant_trigger', p_trigger_key), null);
    end if;
  end if;

  -- Always record the ledger row — even a 0/0 grant — so a one-time
  -- grant stays one-time and the audit shows it fired.
  insert into public.player_grants (profile_id, trigger_key, coins, gems)
  values (p_profile_id, p_trigger_key, rule.coins, rule.gems);
end;
$$;

-- Anti-farming: NOT callable by clients. Only server-side definer
-- code (the signup trigger below, future tap triggers) invokes it.
revoke all on function public.apply_economy_grant(uuid, text) from public, anon, authenticated;

comment on function public.apply_economy_grant(uuid, text) is
  'Apply the economy_grants rule for p_trigger_key to a player: credits coins/gems, logs wallet_transactions, records player_grants. Respects one_time. SECURITY DEFINER and revoked from client roles — call only from server-side triggers/functions to prevent grant farming.';

/* -------------------------------------------------------------------------- */
/* 4. Wire the signup grant into new-player wallet creation                   */
/* -------------------------------------------------------------------------- */

create or replace function private.ensure_user_wallet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_wallets (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  -- Apply the configurable starting balance. No-op if the 'signup'
  -- rule is disabled or absent. Existing players already have wallets
  -- (this trigger is after-insert), so they are NOT retroactively
  -- granted — only genuinely new profiles get it.
  perform public.apply_economy_grant(new.id, 'signup');

  return new;
end;
$$;

/* -------------------------------------------------------------------------- */
/* 5. Admin upsert RPC for the Back Office                                    */
/* -------------------------------------------------------------------------- */

create or replace function public.admin_upsert_economy_grant(
  p_trigger_key text,
  p_display_name text,
  p_description text,
  p_coins int,
  p_gems int,
  p_one_time boolean,
  p_is_enabled boolean,
  p_sort_order int
)
returns public.economy_grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  result public.economy_grants;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.can_manage_config(caller_id) then
    raise exception 'admin_required';
  end if;
  if p_trigger_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid_trigger_key';
  end if;
  if coalesce(p_coins, 0) < 0 or coalesce(p_gems, 0) < 0 then
    raise exception 'amounts_must_be_non_negative';
  end if;

  insert into public.economy_grants (
    trigger_key, display_name, description, coins, gems,
    one_time, is_enabled, sort_order, updated_by, updated_at
  )
  values (
    p_trigger_key, p_display_name, coalesce(p_description, ''),
    coalesce(p_coins, 0), coalesce(p_gems, 0),
    coalesce(p_one_time, true), coalesce(p_is_enabled, true),
    coalesce(p_sort_order, 0), caller_id, now()
  )
  on conflict (trigger_key) do update set
    display_name = excluded.display_name,
    description  = excluded.description,
    coins        = excluded.coins,
    gems         = excluded.gems,
    one_time     = excluded.one_time,
    is_enabled   = excluded.is_enabled,
    sort_order   = excluded.sort_order,
    updated_by   = caller_id,
    updated_at   = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.admin_upsert_economy_grant(text, text, text, int, int, boolean, boolean, int)
  to authenticated;

comment on function public.admin_upsert_economy_grant(text, text, text, int, int, boolean, boolean, int) is
  'Upsert an economy_grants rule. Owner/admin only. Used by the Back Office Economy Grants section. Raises: not_authenticated, admin_required, invalid_trigger_key, amounts_must_be_non_negative.';

/* -------------------------------------------------------------------------- */
/* 6. Seed the signup grant (flat starting balance)                           */
/* -------------------------------------------------------------------------- */

insert into public.economy_grants
  (trigger_key, display_name, description, coins, gems, one_time, is_enabled, sort_order)
values
  ('signup', 'New Player Bonus',
   'Starting balance granted once when a player first joins.',
   10000, 100, true, true, 0)
on conflict (trigger_key) do nothing;
