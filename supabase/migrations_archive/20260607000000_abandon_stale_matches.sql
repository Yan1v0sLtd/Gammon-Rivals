-- Cleanup for abandoned difficulty matches.
--
-- A player who closes the tab mid-match leaves a row sitting at
-- finished_at = null forever. From the dashboard's perspective the
-- entry fee was wagered but no payout will ever happen, which drags
-- actual RTP below target and pollutes the data with noise that
-- doesn't reflect real play decisions.
--
-- This RPC finalises every such row owned by the caller that's older
-- than `p_max_age_minutes` minutes (default 60). Each abandoned match
-- is treated as a loss — the player conceded by walking away — so the
-- existing lose-prize + risk-free-intro logic in finish_match applies.
-- Net effect: the dashboard's wagered/paid-out columns settle, and
-- the player optionally gets their lose-prize back the next time they
-- visit the lobby.
--
-- The client calls this on lobby load. We don't need a periodic
-- backend cleanup for v1 — if a player never comes back, their orphan
-- matches stay open but they don't show up in any active surface
-- either. (A nightly pg_cron sweep is a reasonable follow-up if the
-- abandoned-match count ever climbs.)
--
-- Idempotent on the per-match level via the same `match_already_finished`
-- guard as finish_match — running twice in quick succession either
-- finalises everything once, or no-ops the second time.

create or replace function public.abandon_stale_matches(
  p_max_age_minutes int default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  match_rec record;
  abandoned_count int := 0;
  cap_minutes int := greatest(coalesce(p_max_age_minutes, 60), 1);
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Snapshot the list first so the cursor doesn't see rows we just
  -- finalised (finish_match flips finished_at non-null).
  for match_rec in
    select id, owner_color
    from public.matches
    where owner_id = caller_id
      and finished_at is null
      and table_config_id is not null
      and started_at < now() - (cap_minutes || ' minutes')::interval
  loop
    -- Mark the abandoning player as the loser. owner_color is 'white'
    -- by default for AI-mint matches via enter_room, so the opposite
    -- side wins. finish_match handles the lose-prize / risk-free
    -- payout, audit trail, and idempotency.
    begin
      perform public.finish_match(
        match_rec.id,
        0,
        0,
        case when match_rec.owner_color = 'white' then 'black' else 'white' end,
        null
      );
      abandoned_count := abandoned_count + 1;
    exception when others then
      -- One bad row shouldn't block the rest. The 'match_already_finished'
      -- exception in particular can happen if a parallel call beat us
      -- to it — we just skip and keep going.
      continue;
    end;
  end loop;

  return jsonb_build_object(
    'abandoned_count', abandoned_count,
    'max_age_minutes', cap_minutes
  );
end;
$$;

grant execute on function public.abandon_stale_matches(int) to authenticated;

comment on function public.abandon_stale_matches(int) is
  'Finalises any caller-owned difficulty-room matches older than p_max_age_minutes that never reached finished_at. Each is marked as a loss via finish_match, so the lose-prize / risk-free-intro logic applies and the RTP dashboard data stays honest. Returns jsonb {abandoned_count, max_age_minutes}.';
