-- Phase 6a: public lobby + spectator mode.
-- A match marked is_public can be browsed by strangers in the lobby and
-- watched (spectated) while in progress.

alter table public.matches
  add column is_public boolean not null default false;

create index matches_open_public_idx
  on public.matches (started_at desc)
  where is_public = true and opponent_id is null and finished_at is null;

create index matches_active_public_idx
  on public.matches (started_at desc)
  where is_public = true and opponent_id is not null and finished_at is null;

-- RLS: allow strangers to read public matches in any state.
drop policy if exists "matches_read" on public.matches;
create policy "matches_read"
  on public.matches for select
  using (
    finished_at is not null
    or owner_id = auth.uid()
    or opponent_id = auth.uid()
    or (mode = 'online' and is_public = true)
    or (
      mode = 'online'
      and opponent_id is null
      and invite_code is not null
      and (invite_expires_at is null or invite_expires_at > now())
    )
  );

-- Games + moves should also be readable for public matches (so spectators see live state).
drop policy if exists "games_read_via_match" on public.games;
create policy "games_read_via_match"
  on public.games for select
  using (
    match_id in (
      select id from public.matches
      where finished_at is not null
        or owner_id = auth.uid()
        or opponent_id = auth.uid()
        or (mode = 'online' and is_public = true)
    )
  );

drop policy if exists "moves_read_via_game" on public.moves;
create policy "moves_read_via_game"
  on public.moves for select
  using (
    game_id in (
      select g.id from public.games g
      join public.matches m on g.match_id = m.id
      where m.finished_at is not null
        or m.owner_id = auth.uid()
        or m.opponent_id = auth.uid()
        or (m.mode = 'online' and m.is_public = true)
    )
  );

-- Atomic join for public matches (no invite code required).
create or replace function public.join_public_match(target_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m_id uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  update public.matches
  set opponent_id = caller
  where id = target_match_id
    and mode = 'online'
    and is_public = true
    and opponent_id is null
    and owner_id != caller
    and finished_at is null
  returning id into m_id;

  if m_id is null then
    raise exception 'invalid_or_already_joined';
  end if;

  return m_id;
end;
$$;

grant execute on function public.join_public_match(uuid) to authenticated;
