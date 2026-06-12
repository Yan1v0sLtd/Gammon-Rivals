-- Currency configs — single source of truth for the USD value of every
-- in-game currency. Lets the Back Office surface a $ value / EV column
-- on every place rewards are configured (hourly wheel, daily bonus,
-- level rewards, table prizes, future missions / shop bundles). Without
-- this table those numbers are implicit in the shop seed and the
-- operator has no aggregate view of "what is this slot actually worth?".
--
-- Direct writes are blocked by RLS; the BO goes through
-- admin_upsert_currency_config so we get the same owner/admin gate the
-- rest of the config tables already use.

create table if not exists public.currency_configs (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null,
  -- USD value of ONE unit of the currency, stored in micros (USD ×
  -- 1_000_000) so the math stays in integers. Examples:
  --   1 gem  worth $0.01    → 10_000
  --   1 coin worth $0.0001  → 100
  usd_value_micros bigint not null check (usd_value_micros >= 0),
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.currency_configs is
  'USD value per in-game currency. Source of truth for $ / EV displays in the Back Office. Writes go through admin_upsert_currency_config only.';
comment on column public.currency_configs.usd_value_micros is
  'USD value of one unit in micros (USD × 1_000_000). Example: 1 gem = $0.01 → 10000.';

-- updated_at autotouch (mirrors the pattern used by other config tables)
create or replace function private.touch_currency_configs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists currency_configs_updated_at on public.currency_configs;
create trigger currency_configs_updated_at
  before update on public.currency_configs
  for each row execute function private.touch_currency_configs_updated_at();

-- Read for everyone. Values aren't sensitive — the same numbers will be
-- derivable from the shop bundles anyway — and letting the lobby read
-- them keeps the door open for in-app $ displays later.
alter table public.currency_configs enable row level security;

drop policy if exists "currency_configs_read_all" on public.currency_configs;
create policy "currency_configs_read_all"
  on public.currency_configs for select
  to anon, authenticated
  using (true);

-- No direct write policy. All mutations go through the RPC.

-- Seed canonical defaults. Idempotent — re-running the migration
-- preserves any operator tuning that happened post-seed.
insert into public.currency_configs (code, display_name, usd_value_micros, sort_order)
values
  ('coins', 'Coins', 100,   0),   -- 1 coin = $0.0001  (100 coins = $0.01)
  ('gems',  'Gems',  10000, 1)    -- 1 gem  = $0.01
on conflict (code) do nothing;

-- Admin upsert. Owner/admin only (same gate as the other config
-- tables). Deletes are intentionally not exposed: a currency code is
-- referenced from wheel_slots / daily_bonus_configs / etc. by name, so
-- removing it would orphan rewards. Disable via is_enabled instead.
create or replace function public.admin_upsert_currency_config(
  p_code text,
  p_display_name text,
  p_usd_value_micros bigint,
  p_is_enabled boolean,
  p_sort_order int
)
returns public.currency_configs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  result public.currency_configs;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.can_manage_config(caller_id) then
    raise exception 'admin_required';
  end if;
  if p_usd_value_micros < 0 then
    raise exception 'usd_value_must_be_non_negative';
  end if;
  if p_code !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid_currency_code';
  end if;

  insert into public.currency_configs (
    code, display_name, usd_value_micros, is_enabled, sort_order, updated_by, updated_at
  )
  values (
    p_code, p_display_name, p_usd_value_micros, p_is_enabled, p_sort_order, caller_id, now()
  )
  on conflict (code) do update set
    display_name = excluded.display_name,
    usd_value_micros = excluded.usd_value_micros,
    is_enabled = excluded.is_enabled,
    sort_order = excluded.sort_order,
    updated_by = caller_id,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.admin_upsert_currency_config(text, text, bigint, boolean, int)
  to authenticated;

comment on function public.admin_upsert_currency_config(text, text, bigint, boolean, int) is
  'Upsert a currency_configs row. Owner/admin only via private.can_manage_config. Used by the Back Office Currencies section. Raises: not_authenticated, admin_required, usd_value_must_be_non_negative, invalid_currency_code.';
