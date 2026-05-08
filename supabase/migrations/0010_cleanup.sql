-- Polish: server-side cleanup function for stale rows.
-- Call manually or schedule via pg_cron later. Idempotent.
--   - Open invite-code matches with no opponent and an expired (or null + 24h+ old)
--     invite are marked finished_at = now(). Their games/moves cascade-delete via FK.
--   - Open public lobby matches with no opponent older than 24h are similarly closed.
--   - Matchmaking_queue rows that are matched (matched_match_id IS NOT NULL) but
--     whose match no longer exists are deleted.
--   - Matchmaking_queue rows older than 30 minutes with no match are deleted
--     (treated as the user giving up).

create or replace function public.cleanup_stale_rows()
returns table(closed_matches int, dropped_queue_rows int)
language plpgsql
security definer
set search_path = public
as $$
declare
  closed int;
  dropped int;
begin
  -- Close stale open online matches (private with expired invite or public >24h old)
  update public.matches
  set finished_at = now()
  where finished_at is null
    and mode = 'online'
    and opponent_id is null
    and (
      (invite_code is not null and invite_expires_at is not null and invite_expires_at < now())
      or (started_at < now() - interval '24 hours')
    );
  get diagnostics closed = row_count;

  -- Drop unmatched queue rows older than 30 minutes
  delete from public.matchmaking_queue
  where matched_match_id is null
    and created_at < now() - interval '30 minutes';
  get diagnostics dropped = row_count;

  -- Drop queue rows whose matched match no longer exists
  delete from public.matchmaking_queue
  where matched_match_id is not null
    and matched_match_id not in (select id from public.matches);

  return query select closed, dropped;
end;
$$;

grant execute on function public.cleanup_stale_rows() to authenticated;
