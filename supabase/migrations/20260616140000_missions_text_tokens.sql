-- Dynamic mission display text. Mission titles/subtitles can use {goal} and
-- {tier} placeholders; get_player_missions_today substitutes each player's
-- resolved goal + focus tier at read time, so dynamic missions (personalized,
-- stretch) stop hardcoding a stale number/difficulty. No client change — the
-- client renders whatever title/subtitle the RPC hands it.

create or replace function public.mp_render_mission_text(p_text text, p_goal int, p_tier text)
returns text language sql immutable as $$
  -- {goal} → resolved goal, {tier} → title-cased tier; collapse whitespace +
  -- trim so an empty {tier} leaves no double space; null in → null out.
  select nullif(btrim(regexp_replace(
    replace(
      replace(coalesce(p_text, ''), '{goal}', coalesce(p_goal::text, '')),
      '{tier}', coalesce(p_tier, '')
    ),
    '\s+', ' ', 'g')), '');
$$;

-- Tokenize the match-related templates' copy (others keep literal copy and can
-- be tokenized in the BO as desired).
update public.mission_templates
  set title = 'Play {goal} {tier} matches'
  where mission_type = 'play_matches' and resolution_mode = 'personalized';
update public.mission_templates
  set subtitle = 'Play {goal} {tier} matches'
  where mission_type = 'play_difficulty';
update public.mission_templates
  set subtitle = 'Play {goal} matches'
  where mission_type = 'play_matches' and resolution_mode = 'stretch';

-- Render title + subtitle through the token helper. Replaces the old
-- personalized-title special case + raw subtitle passthrough. Tier resolves
-- from focus_tier (personalized) or params.difficulty_id (fixed-difficulty).
create or replace function public.get_player_missions_today()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller_id uuid := auth.uid();
  v_week_key text := to_char(now(), 'IYYY-"W"IW');
  rerolls_today int;
  cfg public.reroll_pricing_config;
  result jsonb;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.reroll_pricing_config where id = 'default';
  select count(*) into rerolls_today from public.mission_rerolls
  where profile_id = caller_id and rerolled_at::date = current_date;

  result := jsonb_build_object(
    'missions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', pdm.id,
          'template_id', mt.id,
          'rarity', pdm.rarity_slot,
          'period', pdm.period,
          'title', public.mp_render_mission_text(
            mt.title, pdm.resolved_goal,
            initcap(replace(coalesce(pdm.focus_tier, mt.params->>'difficulty_id', ''), 'difficulty-', ''))),
          'subtitle', public.mp_render_mission_text(
            mt.subtitle, pdm.resolved_goal,
            initcap(replace(coalesce(pdm.focus_tier, mt.params->>'difficulty_id', ''), 'difficulty-', ''))),
          'icon_url', mt.icon_url,
          'mission_type', mt.mission_type,
          'metric_code', mt.metric_code,
          'progress', pdm.progress,
          'resolved_goal', pdm.resolved_goal,
          'completed_at', pdm.completed_at,
          'claimed_at', pdm.claimed_at,
          'expires_at', pdm.expires_at,
          'mission_points', mt.mission_points,
          'focus_tier', pdm.focus_tier,
          'reward_coins', pdm.reward_coins,
          'rewards', case
            when pdm.reward_coins is not null then
              jsonb_build_array(jsonb_build_object(
                'reward_kind', 'currency', 'currency_code', 'coins',
                'item_table', null, 'item_id', null,
                'amount', pdm.reward_coins, 'display_order', 0))
            else (
              select coalesce(jsonb_agg(jsonb_build_object(
                'reward_kind', mr.reward_kind, 'currency_code', mr.currency_code,
                'item_table', mr.item_table, 'item_id', mr.item_id,
                'amount', mr.amount, 'display_order', mr.display_order
              ) order by mr.display_order), '[]'::jsonb)
              from public.mission_rewards mr where mr.mission_id = mt.id)
          end
        ) order by
          case pdm.period when 'weekly' then 1 else 0 end,
          case pdm.rarity_slot when 'common' then 1 when 'rare' then 2 when 'epic' then 3 else 4 end,
          pdm.assigned_at, pdm.id
      ), '[]'::jsonb)
      from public.player_daily_missions pdm
      join public.mission_templates mt on mt.id = pdm.mission_template_id
      where pdm.profile_id = caller_id and pdm.expires_at > now()
    ),
    'weekly_pass', coalesce((
      select jsonb_build_object('week_key', wp.week_key, 'mp_earned', wp.mp_earned,
        'chests_claimed', wp.chests_claimed, 'streak_bonus_active', wp.streak_bonus_active)
      from public.player_weekly_pass wp where wp.profile_id = caller_id and wp.week_key = v_week_key
    ), jsonb_build_object('week_key', v_week_key, 'mp_earned', 0,
      'chests_claimed', '[]'::jsonb, 'streak_bonus_active', false)),
    'chest_milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'milestone_index', cm.milestone_index, 'threshold_mp', cm.threshold_mp,
        'display_name', cm.display_name, 'rarity', cm.rarity,
        'rewards', (select coalesce(jsonb_agg(jsonb_build_object(
            'reward_kind', cr.reward_kind, 'currency_code', cr.currency_code,
            'item_table', cr.item_table, 'item_id', cr.item_id,
            'amount', cr.amount, 'display_order', cr.display_order
          ) order by cr.display_order), '[]'::jsonb)
          from public.chest_rewards cr where cr.milestone_id = cm.id)
      ) order by cm.milestone_index), '[]'::jsonb)
      from public.chest_milestones cm where cm.enabled = true),
    'streak', coalesce((
      select jsonb_build_object('current_streak_days', ps.current_streak_days,
        'last_complete_date', ps.last_complete_date,
        'total_streak_chests_claimed', ps.total_streak_chests_claimed)
      from public.player_streak ps where ps.profile_id = caller_id
    ), jsonb_build_object('current_streak_days', 0, 'last_complete_date', null,
      'total_streak_chests_claimed', 0)),
    'streak_chest_rewards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reward_kind', scr.reward_kind, 'currency_code', scr.currency_code,
        'item_table', scr.item_table, 'item_id', scr.item_id,
        'amount', scr.amount, 'display_order', scr.display_order
      ) order by scr.display_order), '[]'::jsonb)
      from public.streak_chest_rewards scr),
    'reroll', jsonb_build_object(
      'rerolls_today', rerolls_today, 'daily_cap', cfg.daily_cap,
      'gem_cost_ladder', cfg.gem_cost_ladder,
      'next_cost', case
        when rerolls_today >= cfg.daily_cap then null
        when rerolls_today >= array_length(cfg.gem_cost_ladder, 1) then null
        else cfg.gem_cost_ladder[rerolls_today + 1] end)
  );
  return result;
end;
$$;
grant execute on function public.get_player_missions_today() to authenticated;
