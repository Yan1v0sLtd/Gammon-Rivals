-- Phase 5d: cube state on the match row + symmetric ELO for online matches.

alter table public.matches
  add column cube_value int not null default 1,
  add column cube_owner text check (cube_owner in ('white', 'black')),
  add column cube_offer text check (cube_offer in ('white', 'black'));

-- Replace rating trigger to handle online matches (both players' ratings move
-- symmetrically). AI-match handling unchanged.
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
  white_id uuid;
  black_id uuid;
  white_r int;
  black_r int;
  white_exp float;
begin
  if new.finished_at is null then return new; end if;
  if old.finished_at is not null then return new; end if;
  if new.winner is null then return new; end if;

  if new.mode = 'online' then
    if new.opponent_id is null then return new; end if;

    if new.owner_color = 'white' then
      white_id := new.owner_id;
      black_id := new.opponent_id;
    else
      white_id := new.opponent_id;
      black_id := new.owner_id;
    end if;

    select rating into white_r from public.profiles where id = white_id;
    select rating into black_r from public.profiles where id = black_id;
    if white_r is null or black_r is null then return new; end if;

    white_exp := 1.0 / (1.0 + power(10.0, (black_r - white_r)::float / 400.0));
    score := case when new.winner = 'white' then 1.0 else 0.0 end;
    delta := round(k_factor * (score - white_exp));

    update public.profiles set rating = greatest(0, white_r + delta) where id = white_id;
    update public.profiles set rating = greatest(0, black_r - delta) where id = black_id;
    return new;
  end if;

  if new.mode not like 'ai-%' then return new; end if;

  ai_rating := case new.mode
    when 'ai-easy'   then 1100
    when 'ai-medium' then 1500
    when 'ai-hard'   then 1900
    else 1500
  end;

  select rating into cur_rating from public.profiles where id = new.owner_id;
  if cur_rating is null then return new; end if;

  expected := 1.0 / (1.0 + power(10.0, (ai_rating - cur_rating)::float / 400.0));
  score := case when new.winner = 'white' then 1.0 else 0.0 end;
  delta := round(k_factor * (score - expected));

  update public.profiles set rating = greatest(0, cur_rating + delta) where id = new.owner_id;
  return new;
end;
$$;
