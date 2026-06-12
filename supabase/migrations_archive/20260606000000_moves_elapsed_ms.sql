-- Move-time telemetry collection.
--
-- Per-ply elapsed time, in milliseconds. Captured client-side at the
-- moment the player commits their move (roll-to-submit window). We
-- store it per row rather than deriving from created_at because the
-- batch insert in saveGame() collapses many turns into one
-- round-trip and the created_at clock is the insert moment, not the
-- think time.
--
-- No detection logic yet — this is pure collection. The signals we're
-- going to want eventually (low stddev across many moves = bot,
-- consistent sub-200ms decisions = scripted, deviation from typical
-- decision-time-vs-position-complexity = inhuman) all need this base
-- column to exist. Adding it now means historical data starts
-- accumulating from day one rather than from the day someone realises
-- they need it.
--
-- Nullable because: legacy rows pre-date the column, the AI's own
-- turns aren't interesting to time, and a client that fails to record
-- the timestamp shouldn't block the save. Check (>= 0) keeps obvious
-- garbage out without forcing the column to be present.

alter table public.moves
  add column elapsed_ms int check (elapsed_ms is null or elapsed_ms >= 0);

comment on column public.moves.elapsed_ms is
  'Player''s think-time on this ply, in milliseconds (roll until submit). Nullable: AI turns and pre-column rows have no value. Used as raw signal for future bot detection.';
