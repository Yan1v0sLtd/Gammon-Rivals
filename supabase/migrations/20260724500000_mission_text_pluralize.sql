-- Apply the {goal|singular|plural} grammar token to every enabled mission
-- template that still hard-codes a plural noun after {goal}. The renderer
-- (mp_render_mission_text) picks the singular when goal = 1, so "Play 1 matches"
-- becomes "Play 1 match" and "Play 3 matches" stays plural. Explicit per-id
-- updates (not a blanket regex) so each noun keeps its own casing.

-- play_matches
update public.mission_templates set subtitle = 'Play {goal} {goal|match|matches}'
  where id in ('e0490dd2-d65f-4ede-91b6-08f36358e89f','34d16db2-4bc0-4943-b031-bbf2060f3fba','7ea8b156-2a15-44a6-b111-5a4be431a019');
update public.mission_templates set subtitle = 'Play {goal} {tier} {goal|match|matches}'
  where id = '880c7507-6fb5-4c59-85a1-1089f5d69373';
update public.mission_templates set subtitle = 'Win {goal} {tier} {goal|match|matches}'
  where id = '5c11a685-3e28-4bcc-8793-a213481c405f';

-- meta_complete_missions
update public.mission_templates set subtitle = 'Complete {goal} {goal|Mission|Missions} this week'
  where id = '60edb72e-0c83-4eda-b660-5b1d5f46a21e';
update public.mission_templates set title = 'Complete {goal} {goal|mission|missions}'
  where id = '77a51f8d-b342-4eb4-836a-d18f0bb09bd6';

-- spend_gems
update public.mission_templates set title = 'Spend {goal} {goal|gem|gems}'
  where id = '66c6a3df-17cb-4959-a79d-dd9fd3fe8234';
update public.mission_templates set subtitle = 'Spend {goal} {goal|Gem|Gems}'
  where id = '82430558-cdce-4f36-8bdc-9161a0f9b58d';

-- spin_wheel
update public.mission_templates set title = 'Spin {goal} {goal|time|times}'
  where id = '910222e0-e3e1-4396-a7bd-13dc233f9193';
update public.mission_templates set subtitle = 'Claim the Hourly Bonus {goal} {goal|Time|Times}'
  where id = 'a0b84b37-668a-4cf1-9fdb-23f15b296092';

-- wager_coins
update public.mission_templates set title = 'Wager {goal} {goal|coin|coins}', subtitle = 'Wager {goal} {goal|coin|coins}'
  where id = '9a19df32-3c95-41f3-8ba2-74dfb6f6885d';
update public.mission_templates set subtitle = 'Play on {goal} {goal|Coin|Coins}'
  where id = '88f32c13-af65-44e7-b531-406e46bba19c';

-- win_coins_net
update public.mission_templates set subtitle = 'Win {goal} {goal|coin|coins}'
  where id = 'a4bbf907-be32-4aa0-8886-bf00dbb6ecc7';

-- win_streak (compound "{goal}-match" modifiers stay singular; only free-standing nouns change)
update public.mission_templates set subtitle = 'Win {goal} {goal|match|matches} in a row'
  where id = '4fc8b143-5efe-458c-b6f6-4cc711729d0c';
update public.mission_templates set subtitle = 'Win {goal} {goal|match|matches} in a row.'
  where id = '4098a085-43b2-4a3b-bbf6-d99b8ddcc959';
