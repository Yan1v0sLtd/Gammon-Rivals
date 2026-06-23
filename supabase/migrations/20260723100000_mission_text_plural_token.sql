-- Add a pluralization token to mission display text so authors can write copy
-- that reads correctly whether a player's resolved goal is 1 or many.
--
--   {goal|singular|plural}  →  renders `singular` when goal = 1, else `plural`.
--
-- {goal} stays the number. Example subtitle:
--   "Spin the wheel {goal} {goal|time|times}"
--     goal=1 → "Spin the wheel 1 time"
--     goal=5 → "Spin the wheel 5 times"
--
-- The plural token is resolved BEFORE the bare {goal} substitution. (They don't
-- actually collide -- replace('{goal}') matches only the exact "{goal}" literal,
-- never "{goal|...}" -- but resolving the pipe form first keeps intent clear.)
-- The replacement form is chosen once from p_goal and applied to every match,
-- since a single mission has one goal value. Backreferences: \1 = singular,
-- \2 = plural. A NULL/!=1 goal falls back to the plural form.

create or replace function public.mp_render_mission_text(p_text text, p_goal int, p_tier text)
returns text language sql immutable as $$
  -- {goal|sing|plur} → sing/plur by goal; {goal} → number; {tier} → tier.
  -- Collapse whitespace + trim so an empty {tier} leaves no double space;
  -- null in → null out.
  select nullif(btrim(regexp_replace(
    replace(
      replace(
        regexp_replace(
          coalesce(p_text, ''),
          '\{goal\|([^|}]*)\|([^}]*)\}',
          case when coalesce(p_goal, 0) = 1 then '\1' else '\2' end,
          'g'),
        '{goal}', coalesce(p_goal::text, '')),
      '{tier}', coalesce(p_tier, '')
    ),
    '\s+', ' ', 'g')), '');
$$;

comment on function public.mp_render_mission_text(text, int, text) is
  'Renders mission title/subtitle tokens: {goal} (number), {tier} (title-cased tier), and {goal|singular|plural} (picks singular when goal=1, else plural). Whitespace-collapsed; null in → null out.';
