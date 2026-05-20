-- Tighten the enter_room back-compat shim.
--
-- 20260611_enter_room_back_compat originally routed stale clients
-- straight to enter_room_ai_fallback so they wouldn't get the
-- "function does not exist" error mid-rollout. The unintended
-- consequence (caught in production by Yaniv + Hollis test): a
-- player on a cached old client never joins matchmaking. The
-- counterparty (new client) polls find_match_in_tier, finds no
-- partner, times out at 4s, and ALSO falls back to AI. So both
-- end up in separate AI matches instead of a PvP match.
--
-- Fix: shim now raises stale_client_reload immediately. The client
-- error handler surfaces this in the modal toast so the player
-- knows to refresh. No silent AI-fallback substitution.
--
-- This is still a small regression for the brief window where
-- someone has both an old tab and ONLY uses the lobby modal —
-- but the alternative (silent AI substitution that locks them out
-- of matchmaking) is worse because the player has no way to know
-- something went wrong.

create or replace function public.enter_room(
  p_table_config_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- p_table_config_id is referenced so the parameter doesn't appear
  -- unused — even though we don't read it, plpgsql warns otherwise
  -- and we may want it in a future variant.
  perform p_table_config_id;
  raise exception 'stale_client_reload';
end;
$$;

grant execute on function public.enter_room(text) to authenticated;

comment on function public.enter_room(text) is
  'Stale-client back-compat. Raises stale_client_reload so the client surfaces a "please refresh" toast. Replaces the 20260611 shim that silently routed to enter_room_ai_fallback (which locked stale tabs out of PvP matchmaking).';
