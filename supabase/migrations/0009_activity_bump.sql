-- Polish: keep matches.updated_at as the canonical "last activity" timestamp.
-- The set_updated_at trigger already handles match UPDATEs; we add a parallel
-- trigger that bumps the parent match when a moves row is INSERTed (turn end).
-- This lets the client compute "opponent inactive for N seconds" off a single
-- column and offer a "Claim victory" button after a threshold.

create or replace function public.bump_match_activity_on_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.matches
  set updated_at = now()
  where id = (select match_id from public.games where id = new.game_id);
  return new;
end;
$$;

create trigger moves_bump_match_activity
  after insert on public.moves
  for each row execute function public.bump_match_activity_on_move();
