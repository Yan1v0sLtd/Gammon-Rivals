-- Replace the auto-profile trigger to pick a random first name from a
-- short list, instead of the legacy "Player XXXXXX" pattern. Players can
-- still rename themselves via setDisplayName(); this is just a friendlier
-- default. Existing rows whose display_name still matches the legacy
-- pattern are backfilled too, so old profiles also get a real name.

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
begin
  insert into public.profiles (id, display_name, is_guest, avatar_seed)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      names[1 + floor(random() * array_length(names, 1))::int]
    ),
    coalesce(new.is_anonymous, false),
    substr(md5(new.id::text || clock_timestamp()::text), 1, 12)
  );
  return new;
end;
$$;

-- Backfill: any profile whose name is the legacy "Player XXXXXX" pattern
-- gets a random nice name. Anyone who already chose a real name is left
-- alone.
update public.profiles
set display_name = (
  array[
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
  ]
)[1 + floor(random() * 80)::int]
where display_name ~ '^Player [a-f0-9]{6}$';
