-- Phase 6b: ELO-based auto-matchmaking.
-- A queue table holds players waiting for a match. The matchmake RPC
-- enqueues the caller, looks for the closest-rated waiting partner with the
-- same target, and atomically creates a match + updates both queue rows.

create table public.matchmaking_queue (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  target int not null check (target >= 1),
  rating int not null,
  matched_match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index matchmaking_queue_search_idx
  on public.matchmaking_queue (target, rating)
  where matched_match_id is null;

alter table public.matchmaking_queue enable row level security;

-- Players see their own row; matched rows can be read by both participants
-- (so the partner sees the match_id assignment). Inserts/deletes go through
-- RPCs (security-definer), so we don't grant direct write access here.
create policy "queue_read_own"
  on public.matchmaking_queue for select
  using (profile_id = auth.uid());

create policy "queue_delete_own"
  on public.matchmaking_queue for delete
  using (profile_id = auth.uid());

-- Add to Realtime so the client can listen for matched_match_id assignment.
alter publication supabase_realtime add table public.matchmaking_queue;

create or replace function public.matchmake(p_target int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_rating int;
  partner_id uuid;
  new_match_id uuid;
  rows_updated int;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  if p_target < 1 then raise exception 'invalid target'; end if;

  select rating into caller_rating from public.profiles where id = caller;
  if caller_rating is null then return null; end if;

  -- Idempotent enqueue: if caller is already queued, refresh and unmatch.
  insert into public.matchmaking_queue (profile_id, target, rating)
  values (caller, p_target, caller_rating)
  on conflict (profile_id) do update
    set target = excluded.target,
        rating = excluded.rating,
        created_at = now(),
        matched_match_id = null;

  -- Pick the closest-rated waiting partner with the same target.
  select profile_id into partner_id
  from public.matchmaking_queue
  where profile_id != caller
    and target = p_target
    and matched_match_id is null
  order by abs(rating - caller_rating), created_at
  limit 1;

  if partner_id is null then
    return null; -- still queued, wait for someone else to call matchmake
  end if;

  -- Create the match. Caller is owner (white by default).
  insert into public.matches (owner_id, opponent_id, mode, target, owner_color, is_public)
  values (caller, partner_id, 'online', p_target, 'white', false)
  returning id into new_match_id;

  -- Atomically claim both queue rows. If the partner was already matched
  -- by a competing concurrent call, this updates only one row and we
  -- detect the race.
  update public.matchmaking_queue
  set matched_match_id = new_match_id
  where profile_id in (caller, partner_id)
    and matched_match_id is null;

  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    -- Lost the race; remove the match record we created and stay queued.
    delete from public.matches where id = new_match_id;
    -- Make sure caller's row is still queued (in case the partner was the
    -- one matched first and we accidentally claimed our own row only).
    update public.matchmaking_queue
      set matched_match_id = null
      where profile_id = caller and matched_match_id = new_match_id;
    return null;
  end if;

  return new_match_id;
end;
$$;

grant execute on function public.matchmake(int) to authenticated;

create or replace function public.cancel_matchmaking()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not authenticated'; end if;
  delete from public.matchmaking_queue
    where profile_id = caller and matched_match_id is null;
end;
$$;

grant execute on function public.cancel_matchmaking() to authenticated;
