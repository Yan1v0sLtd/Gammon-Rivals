-- Phase 5b: in-progress turn state on the match row + which game we're playing.
-- Both populated by the roll_dice edge function on first roll of a turn.

alter table public.matches
  add column current_turn jsonb,
  add column current_game_id uuid references public.games(id) on delete set null;
