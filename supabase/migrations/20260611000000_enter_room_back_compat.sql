-- Backward-compatible shim for clients still calling enter_room(text).
--
-- Migration 20260609 dropped the old enter_room RPC in favour of the
-- find_match_in_tier + enter_room_ai_fallback pair. That made any
-- in-flight tab running cached client code fail with "function does
-- not exist" mid-rollout — symptom in the lobby was the "Could not
-- enter the room. Try again." toast.
--
-- This shim restores the single-arg signature and just delegates to
-- enter_room_ai_fallback. The semantics differ slightly (the old RPC
-- ran the matchmaking-aware AI level logic too), but in practice
-- enter_room_ai_fallback IS what the new flow uses for the AI side
-- anyway, so this is the right backwards-compatible body. Once we're
-- confident no stale clients are calling enter_room, we can drop this
-- again.

create or replace function public.enter_room(
  p_table_config_id text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.enter_room_ai_fallback(p_table_config_id);
$$;

grant execute on function public.enter_room(text) to authenticated;

comment on function public.enter_room(text) is
  'Backward-compatible shim. Delegates to enter_room_ai_fallback so stale clients pre-PvP-online rollout still work. Remove once telemetry confirms no callers remain.';
