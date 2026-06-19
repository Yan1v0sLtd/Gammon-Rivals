-- Self-service account deletion.
--
-- Google Play requires apps that let users create accounts to provide an
-- in-app path AND a public web URL to request account + data deletion; this
-- RPC is the server side of both (the in-app Profile action and the public
-- /delete-account page both call it).
--
-- It mirrors admin_hard_delete_user's cascade — deleting the auth.users row
-- cascades through public.profiles to every player_* / user_* / wallet /
-- match table (see that migration's FK map) — but is scoped to the CALLER
-- (auth.uid()), with NO admin gate and NO self-delete guard, because here
-- self-deletion is the entire point. The only non-cascade FK
-- (matches.opponent_id, ON DELETE NO ACTION) is nulled first so the cascade
-- can proceed. Irreversible.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- matches.opponent_id is ON DELETE NO ACTION; null the caller's opponent
  -- references so the auth.users delete can cascade through profiles.
  update public.matches set opponent_id = null where opponent_id = caller_id;

  -- Delete the auth user; cascades to profiles + all player_*/user_* data.
  delete from auth.users where id = caller_id;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Self-service account deletion: the signed-in caller permanently deletes their own account and all associated data. SECURITY DEFINER, scoped to auth.uid(); no admin gate. Nulls the caller''s matches.opponent_id references then deletes auth.users (cascades to profiles + all player_*/user_* tables). Irreversible. Raises: not_authenticated. Backs the in-app Profile "Delete account" action and the public /delete-account page (Google Play data-deletion requirement).';
