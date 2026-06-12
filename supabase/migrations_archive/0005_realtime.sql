-- Phase 5c: enable Supabase Realtime postgres_changes for online play.
-- We listen for UPDATE on matches (current_turn changes, score updates, finished_at)
-- and INSERT on moves. RLS still filters which rows get pushed to each subscriber.

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.moves;
