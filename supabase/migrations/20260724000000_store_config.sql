-- Store presentation config — a single global, always-present singleton the
-- back-office edits to theme the storefront: the header title (default
-- "Store", e.g. "Shop Sale!" during a promo) and an optional blurred background
-- image (e.g. an "American" theme for a 4th-of-July sale).
--
-- Independent of store_sales on purpose: an operator can rename / re-theme the
-- shop with or without a running sale. The storefront reads it directly (public
-- select); only config managers can write. One row, pinned to id = true.

create table if not exists public.store_config (
  id            boolean primary key default true,
  title         text not null default 'Store',
  bg_image_url  text,
  updated_at    timestamptz not null default now(),
  constraint store_config_singleton check (id = true)
);

drop trigger if exists trg_store_config_set_updated_at on public.store_config;
create trigger trg_store_config_set_updated_at
  before update on public.store_config
  for each row execute function public.set_updated_at();

alter table public.store_config enable row level security;

-- Everyone (guests included) can read — the storefront shows the title + BG.
drop policy if exists store_config_select_all on public.store_config;
create policy store_config_select_all on public.store_config
  for select using (true);

-- Only config managers (the back-office) can write.
drop policy if exists store_config_write_config on public.store_config;
create policy store_config_write_config on public.store_config
  for all using (private.can_manage_config(auth.uid()))
  with check (private.can_manage_config(auth.uid()));

-- Seed the single row (default title, no themed BG) so the storefront always
-- has a value and the BO edits via a plain update/upsert.
insert into public.store_config (id, title) values (true, 'Store')
on conflict (id) do nothing;
