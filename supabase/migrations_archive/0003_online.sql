-- Phase 5a: schema + invite/join flow for online multiplayer.
-- This is foundation only — no gameplay loop yet (that lands in 5b).

-- Extend mode enum to include 'online'
alter table public.matches
  drop constraint matches_mode_check;

alter table public.matches
  add constraint matches_mode_check check (
    mode in ('hotseat', 'ai-easy', 'ai-medium', 'ai-hard', 'online')
  );

-- New columns for online matches
alter table public.matches
  add column opponent_id uuid references public.profiles(id),
  add column owner_color text not null default 'white' check (owner_color in ('white', 'black')),
  add column invite_code text,
  add column invite_expires_at timestamptz;

create unique index matches_invite_code_uniq
  on public.matches (invite_code)
  where invite_code is not null;

create index matches_opponent_id_idx on public.matches (opponent_id);

-- =========================================================================
-- RLS: extend access to opponents and to anyone holding a valid invite code.
-- =========================================================================
drop policy if exists "matches_read_finished_or_own" on public.matches;
create policy "matches_read"
  on public.matches for select
  using (
    finished_at is not null
    or owner_id = auth.uid()
    or opponent_id = auth.uid()
    or (
      mode = 'online'
      and opponent_id is null
      and invite_code is not null
      and (invite_expires_at is null or invite_expires_at > now())
    )
  );

drop policy if exists "matches_update_own" on public.matches;
create policy "matches_update_own_or_opponent"
  on public.matches for update
  using (owner_id = auth.uid() or opponent_id = auth.uid());

-- Games / moves: extend insert + read to opponents.
drop policy if exists "games_read_via_match" on public.games;
create policy "games_read_via_match"
  on public.games for select
  using (
    match_id in (
      select id from public.matches
      where finished_at is not null
        or owner_id = auth.uid()
        or opponent_id = auth.uid()
    )
  );

drop policy if exists "games_insert_via_match" on public.games;
create policy "games_insert_via_match"
  on public.games for insert
  with check (
    match_id in (
      select id from public.matches
      where owner_id = auth.uid() or opponent_id = auth.uid()
    )
  );

drop policy if exists "games_update_via_match" on public.games;
create policy "games_update_via_match"
  on public.games for update
  using (
    match_id in (
      select id from public.matches
      where owner_id = auth.uid() or opponent_id = auth.uid()
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
    )
  );

drop policy if exists "moves_insert_via_game" on public.moves;
create policy "moves_insert_via_game"
  on public.moves for insert
  with check (
    game_id in (
      select g.id from public.games g
      join public.matches m on g.match_id = m.id
      where m.owner_id = auth.uid() or m.opponent_id = auth.uid()
    )
  );

-- =========================================================================
-- join_match_by_invite: atomic join with validation.
-- Returns the match ID on success; raises an exception otherwise.
-- =========================================================================
create or replace function public.join_match_by_invite(invite text)
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
  where invite_code = invite
    and mode = 'online'
    and opponent_id is null
    and owner_id != caller
    and (invite_expires_at is null or invite_expires_at > now())
  returning id into m_id;

  if m_id is null then
    raise exception 'invalid_or_expired_invite';
  end if;

  return m_id;
end;
$$;

grant execute on function public.join_match_by_invite(text) to authenticated;
