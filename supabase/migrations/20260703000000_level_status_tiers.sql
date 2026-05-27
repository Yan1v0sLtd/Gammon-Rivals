-- Level status tiers — declarative level-range → rank-label config.
--
-- Before this migration, every level_configs row carried its own
-- status_label string. Setting "L1-L20 = Rookie, L21-L40 = Skilled"
-- meant individually editing 40 rows; regenerating the curve from the
-- BO Curve Proposal silently reset every new row back to the default
-- 'Rookie' because the upsert didn't carry status_label.
--
-- This table holds the tiers as a small declarative config (~5-10
-- rows). The lobby's getProfileProgression derives statusLabel from
-- the first enabled tier whose [level_from, level_to] range contains
-- the player's level. If no tier matches, it falls back to
-- level_configs.status_label (so existing data still works) and
-- finally to 'Rookie'.
--
-- Why a dedicated table instead of a JSON blob on, say, currency_configs:
-- we get RLS, the standard updated_at + audit-log triggers, and
-- structured queries for free. Cheap and consistent with every other
-- admin-configured table in this schema.

create table if not exists public.level_status_tiers (
  id uuid primary key default gen_random_uuid(),
  level_from int not null check (level_from > 0),
  level_to int not null check (level_to > 0),
  label text not null check (length(trim(label)) > 0),
  sort_order int not null default 0,
  is_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (level_to >= level_from)
);

create index if not exists level_status_tiers_range_idx
  on public.level_status_tiers (level_from, level_to)
  where is_enabled;

drop trigger if exists level_status_tiers_updated_at on public.level_status_tiers;
create trigger level_status_tiers_updated_at
  before update on public.level_status_tiers
  for each row execute function public.set_updated_at();

alter table public.level_status_tiers enable row level security;

drop policy if exists "level_status_tiers_read_all" on public.level_status_tiers;
create policy "level_status_tiers_read_all"
  on public.level_status_tiers for select
  using (true);

drop policy if exists "level_status_tiers_insert_admin" on public.level_status_tiers;
create policy "level_status_tiers_insert_admin"
  on public.level_status_tiers for insert
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "level_status_tiers_update_admin" on public.level_status_tiers;
create policy "level_status_tiers_update_admin"
  on public.level_status_tiers for update
  using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

drop policy if exists "level_status_tiers_delete_admin" on public.level_status_tiers;
create policy "level_status_tiers_delete_admin"
  on public.level_status_tiers for delete
  using (private.can_manage_config(auth.uid()));

drop trigger if exists level_status_tiers_audit_log on public.level_status_tiers;
create trigger level_status_tiers_audit_log
  after insert or update or delete on public.level_status_tiers
  for each row execute function private.log_admin_config_change();

-- Seed the existing 4-tier backfill scheme (from the
-- 20260513083430_google_guest_progression migration) so the BO has
-- something visible from day one. Admin can edit / extend freely.
-- Skipped if rows already exist (idempotent).
insert into public.level_status_tiers (level_from, level_to, label, sort_order)
select * from (values
  (1, 4, 'Rookie', 1),
  (5, 9, 'Skilled', 2),
  (10, 19, 'Veteran', 3),
  (20, 9999, 'Elite', 4)
) as v(level_from, level_to, label, sort_order)
where not exists (select 1 from public.level_status_tiers);

comment on table public.level_status_tiers is
  'Maps a player-level range to a rank label (Rookie, Skilled, etc.). The lobby derives the displayed status_label from this table; level_configs.status_label is a legacy fallback.';
