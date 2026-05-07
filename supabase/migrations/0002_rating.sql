-- Phase 4d: ELO-style rating on profiles, auto-updated when an AI match finishes.
-- Hot-seat matches don't affect rating (same human plays both sides).
-- PvP rating updates land in Phase 5.

alter table public.profiles
  add column rating int not null default 1500;

create index profiles_rating_idx on public.profiles (rating desc);

create or replace function public.update_rating_on_match_finish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ai_rating int;
  cur_rating int;
  expected float;
  score float;
  k_factor int := 24;
  delta int;
begin
  -- Only act on the transition null -> non-null
  if new.finished_at is null then return new; end if;
  if old.finished_at is not null then return new; end if;

  -- Only AI matches change rating
  if new.mode not like 'ai-%' then return new; end if;
  if new.winner is null then return new; end if;

  ai_rating := case new.mode
    when 'ai-easy'   then 1100
    when 'ai-medium' then 1500
    when 'ai-hard'   then 1900
    else 1500
  end;

  select rating into cur_rating from public.profiles where id = new.owner_id;
  if cur_rating is null then return new; end if;

  -- Owner is always white in AI matches in this phase.
  expected := 1.0 / (1.0 + power(10.0, (ai_rating - cur_rating)::float / 400.0));
  score := case when new.winner = 'white' then 1.0 else 0.0 end;
  delta := round(k_factor * (score - expected));

  update public.profiles
  set rating = greatest(0, cur_rating + delta)
  where id = new.owner_id;

  return new;
end;
$$;

create trigger matches_rating_update
  after update of finished_at on public.matches
  for each row
  when (new.finished_at is not null and old.finished_at is null)
  execute function public.update_rating_on_match_finish();
