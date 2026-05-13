-- Google + explicit guest auth and progression display support.

-- Keep profile/progression data when an auth user is removed accidentally.
-- Manual profile cleanup should be done deliberately through Back Office later.
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id)
  references auth.users(id)
  on delete restrict;

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_note text;

create index if not exists profiles_deleted_at_idx on public.profiles (deleted_at);

alter table public.level_configs
  add column if not exists status_label text not null default 'Rookie';

update public.level_configs
set status_label = case
  when level < 5 then 'Rookie'
  when level < 10 then 'Skilled'
  when level < 20 then 'Pro'
  else 'Elite'
end
where status_label = 'Rookie';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  names text[] := array[
    'Alex','Riley','Jordan','Casey','Morgan','Quinn','Avery','Emerson',
    'Reese','Sage','River','Rowan','Skyler','Tatum','Drew','Phoenix',
    'Cameron','Hayden','Charlie','Eden','Finley','Frankie','Harper',
    'Hunter','Jamie','Jesse','Kai','Logan','Marlowe','Nico','Parker',
    'Peyton','Remy','Robin','Ryan','Shay','Sky','Sutton','Taylor',
    'Wren','Adrian','Ari','Bailey','Blair','Blake','Brett','Devon',
    'Dylan','Ellis','Evan','Gray','Hollis','Indigo','Jules','Kendall',
    'Kenzie','Kit','Lane','Lennon','Lior','Maren','Mika','Noa',
    'Oakley','Ocean','Onyx','Quincy','Ramsey','Rio','Rory','Sasha',
    'Shiloh','Sloan','Tristan','Val','Vesper','Wells','Winter','Zion'
  ];
  is_guest_user boolean := coalesce(new.is_anonymous, false);
  fallback_name text := names[1 + floor(random() * array_length(names, 1))::int];
  google_name text := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, ''), '@', 1)
  )), '');
  google_avatar text := nullif(coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  ), '');
begin
  insert into public.profiles (id, display_name, is_guest, avatar_seed, avatar_url, level, xp)
  values (
    new.id,
    case when is_guest_user then fallback_name else coalesce(google_name, fallback_name) end,
    is_guest_user,
    substr(md5(new.id::text || clock_timestamp()::text), 1, 12),
    case when is_guest_user then null else google_avatar end,
    1,
    0
  )
  on conflict (id) do update
    set
      is_guest = excluded.is_guest,
      avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
      display_name = case
        when public.profiles.display_name ~ '^Player [a-f0-9]{6}$'
          then excluded.display_name
        else public.profiles.display_name
      end;

  return new;
end;
$$;
