-- Phase 4a: profiles, matches, games, moves + RLS + auto-profile trigger.
-- Schema is intentionally simple. AI matches use a `mode` enum string;
-- we do NOT create profiles for AI bots (avoids polluting auth.users).
-- Online play (Phase 5) will add opponent_id additively.

-- ===========================================
-- updated_at trigger fn
-- ===========================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================
-- profiles — one row per auth.users row.
-- Auto-populated via on_auth_user_created trigger below.
-- ===========================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_guest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a new auth user signs up (anonymous or email).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      'Player ' || substr(new.id::text, 1, 6)
    ),
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================
-- matches
-- ===========================================
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('hotseat', 'ai-easy', 'ai-medium', 'ai-hard')),
  target int not null check (target >= 1),
  white_score int not null default 0,
  black_score int not null default 0,
  winner text check (winner in ('white', 'black')),
  crawford_game_number int,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index matches_owner_id_idx on public.matches (owner_id);
create index matches_finished_at_idx on public.matches (finished_at);

create trigger matches_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- ===========================================
-- games (one per game inside a match)
-- ===========================================
create table public.games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  game_number int not null,
  winner text check (winner in ('white', 'black')),
  win_type text check (win_type in ('single', 'gammon', 'backgammon')),
  cube_value int not null default 1,
  cube_owner text check (cube_owner in ('white', 'black')),
  dropped_double boolean not null default false,
  points_awarded int not null default 0,
  was_crawford boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (match_id, game_number)
);

create index games_match_id_idx on public.games (match_id);

-- ===========================================
-- moves (per turn — one row per turn, with sub-moves as JSONB)
-- ===========================================
create table public.moves (
  id bigserial primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  ply int not null,
  player text not null check (player in ('white', 'black')),
  dice int[] not null,
  sub_moves jsonb not null,
  created_at timestamptz not null default now(),
  unique (game_id, ply)
);

create index moves_game_id_idx on public.moves (game_id);

-- ===========================================
-- RLS
-- Reads: profiles + finished matches/games/moves are public (for leaderboards / replays).
-- Writes: gated to the owning auth user.
-- ===========================================
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.moves enable row level security;

-- profiles
create policy "profiles_read_all"
  on public.profiles for select using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- matches
create policy "matches_read_finished_or_own"
  on public.matches for select
  using (finished_at is not null or owner_id = auth.uid());

create policy "matches_insert_own"
  on public.matches for insert
  with check (owner_id = auth.uid());

create policy "matches_update_own"
  on public.matches for update
  using (owner_id = auth.uid());

-- games
create policy "games_read_via_match"
  on public.games for select
  using (
    match_id in (
      select id from public.matches
      where finished_at is not null or owner_id = auth.uid()
    )
  );

create policy "games_insert_via_match"
  on public.games for insert
  with check (
    match_id in (select id from public.matches where owner_id = auth.uid())
  );

create policy "games_update_via_match"
  on public.games for update
  using (
    match_id in (select id from public.matches where owner_id = auth.uid())
  );

-- moves
create policy "moves_read_via_game"
  on public.moves for select
  using (
    game_id in (
      select g.id from public.games g
      join public.matches m on g.match_id = m.id
      where m.finished_at is not null or m.owner_id = auth.uid()
    )
  );

create policy "moves_insert_via_game"
  on public.moves for insert
  with check (
    game_id in (
      select g.id from public.games g
      join public.matches m on g.match_id = m.id
      where m.owner_id = auth.uid()
    )
  );
