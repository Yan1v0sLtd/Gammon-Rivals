-- First-run onboarding tour: remember whether a player has seen the tutorial
-- so it shows exactly once. Stored on the profile (not localStorage) so it
-- follows the account across devices and survives the guest -> Google upgrade.

alter table public.profiles
  add column if not exists tutorial_completed_at timestamptz;

comment on column public.profiles.tutorial_completed_at is
  'When the player finished or skipped the first-run onboarding tour. NULL = not seen yet. Set via public.mark_tutorial_complete().';

-- Self-scoped setter: stamps the flag for the calling user only. SECURITY
-- DEFINER so it does not depend on a broad profiles UPDATE policy. Idempotent
-- (the NULL guard means the first write wins and re-calls never move the time),
-- so "Skip" and a later genuine completion can't fight each other.
create or replace function public.mark_tutorial_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
    set tutorial_completed_at = now()
    where id = auth.uid()
      and tutorial_completed_at is null;
end;
$$;

-- Player RPC: callable by the player's own session (guests are authenticated
-- via anonymous sign-in). Matches the grant pattern of the other player RPCs.
revoke execute on function public.mark_tutorial_complete() from public;
grant execute on function public.mark_tutorial_complete() to authenticated, anon;
