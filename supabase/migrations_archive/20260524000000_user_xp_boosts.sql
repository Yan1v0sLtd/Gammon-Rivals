-- XP Boost buffs.
--
-- Each row represents a time-limited XP multiplier the player has earned
-- (from a shop purchase today; could come from admin grants, daily-bonus
-- streaks, events, etc. in the future). The wire format for grants from
-- shop_items.contents.grants is:
--
--   "xpBoost": { "days": 7, "multiplier": 2 }
--
-- Stacking rule: when a player has multiple active boosts, the highest
-- multiplier wins (no additive stacking). Buying a new boost while one
-- is already active inserts a new row rather than extending — that lets
-- a future Back Office tool see "this player bought X / Y boosts on
-- date Z" rather than a single mutated row.
--
-- The hot-path read is `current_xp_multiplier(profile_id)`, which is
-- called inside claim_daily_bonus() (and any future XP-award RPC) to
-- multiply the granted XP. It returns 1 when there is no active boost,
-- so callers can do `xp * current_xp_multiplier(uid)` unconditionally.

create table public.user_xp_boosts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  multiplier  int  not null check (multiplier between 2 and 10),
  expires_at  timestamptz not null,
  source      text not null check (source in ('purchase', 'admin', 'daily_bonus', 'event', 'test')),
  shop_item_id text references public.shop_items(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Indexed for the "active boosts for this profile" query, which is the
-- only thing we ever read here. `expires_at desc` lets the planner stop
-- early once it sees an expired row when scanning a single profile.
create index user_xp_boosts_profile_expires_idx
  on public.user_xp_boosts (profile_id, expires_at desc);

alter table public.user_xp_boosts enable row level security;

-- Players can read their own active+expired history. Writes go through
-- SECURITY DEFINER RPCs only (purchase_shop_item, admin tools later).
create policy "user_xp_boosts_self_read"
  on public.user_xp_boosts
  for select
  using (profile_id = auth.uid());

-- Resolve the player's current XP multiplier. SECURITY DEFINER so it
-- can be called from anywhere — including from RPCs that don't have
-- their own RLS bypass — while still being scoped to a single profile
-- via the explicit argument. Returns 1 when no active boost exists so
-- callers can multiply unconditionally.
create or replace function public.current_xp_multiplier(target_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(multiplier), 1)::int
  from public.user_xp_boosts
  where profile_id = target_profile_id
    and expires_at > now();
$$;

grant execute on function public.current_xp_multiplier(uuid) to authenticated;

comment on table public.user_xp_boosts is
  'Time-limited XP multipliers earned by a player. Highest active multiplier wins (no additive stacking). Writes only via SECURITY DEFINER RPCs.';

comment on function public.current_xp_multiplier(uuid) is
  'Returns the highest active XP multiplier for the given profile, or 1 if no boost is active. Used by XP-granting RPCs to scale rewards.';
