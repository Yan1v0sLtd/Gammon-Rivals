-- Render the {goal} token with thousands separators (2750 -> "2,750") so big
-- goals read cleanly in mission titles/subtitles, e.g. "Wager 2,750 coins".
-- FM strips the padding to_char would otherwise add; the {goal|sing|plural} and
-- {tier} tokens are unchanged. (The progress "0 / 2,750" count is comma-formatted
-- client-side.)
create or replace function public.mp_render_mission_text(p_text text, p_goal int, p_tier text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(
    replace(
      replace(
        regexp_replace(
          coalesce(p_text, ''),
          '\{goal\|([^|}]*)\|([^}]*)\}',
          case when coalesce(p_goal, 0) = 1 then '\1' else '\2' end,
          'g'),
        '{goal}', coalesce(to_char(p_goal, 'FM999,999,999,999'), '')),
      '{tier}', coalesce(p_tier, '')
    ),
    '\s+', ' ', 'g')), '');
$$;
