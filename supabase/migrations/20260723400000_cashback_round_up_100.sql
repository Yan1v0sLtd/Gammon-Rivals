-- Cashback reward: round UP to the next 100 (was: nearest 50), so players get
-- clean hundreds in their favour (e.g. 11,027 -> 11,100). Only the cashback
-- sizing changes; the manual bundle + personalized engine are untouched.
create or replace function public.mp_cashback_reward(t public.mission_templates, p_goal int)
returns int language plpgsql stable as $$
declare
  v_fee int;
  v_rtp int;
  v_edge numeric;
  v_investment numeric;
begin
  if t.reward_mode <> 'cashback' or coalesce(t.cashback_pct, 0) <= 0 or coalesce(p_goal, 0) <= 0 then
    return null;
  end if;

  select tc.entry_fee_coins, tc.target_rtp_pct into v_fee, v_rtp
  from public.table_configs tc
  where tc.id = 'difficulty-' || nullif(t.params->>'difficulty_id', '');
  v_edge := 1 - coalesce(v_rtp, 90) / 100.0;

  if t.metric_code = 'coins_wagered_per_day' then
    v_investment := p_goal;
  elsif v_fee is not null then
    v_investment := p_goal::numeric * v_fee;
  else
    return null;
  end if;

  return greatest(0, (ceil((t.cashback_pct * v_investment * v_edge) / 100.0) * 100)::int);
end;
$$;
