-- Add an avatar seed so each profile has a deterministic avatar generated
-- by DiceBear (https://api.dicebear.com). The seed is just a short string —
-- nothing identifying — and the same seed always produces the same SVG, so
-- we don't need to store the avatar image itself anywhere.
--
-- New rows get a random seed automatically; existing rows are seeded with
-- their profile id (which is unique and stable) so they have a well-defined
-- avatar from day one.

alter table public.profiles
  add column if not exists avatar_seed text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 12);

update public.profiles
set avatar_seed = substr(md5(id::text), 1, 12)
where avatar_seed is null or avatar_seed = '';
