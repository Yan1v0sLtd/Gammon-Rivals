-- Room economy columns + tier reseed.
--
-- Three new BO-tunable columns on table_configs so operators can shift
-- the entire payout curve without touching code:
--
--   prize_coins_loss — Coins refunded to the loser. Pairs with the
--                      existing prize_coins (win) so each tier has a
--                      full W/L payout. Together they let operators
--                      hit a target RTP at the assumed win probability.
--
--   ai_level         — Which AI strength this tier uses ('easy' /
--                      'medium' / 'hard'). enter_room composes the
--                      match.mode as 'ai-' || ai_level and (when the
--                      win-streak escalator fires) bumps it one step
--                      harder. Stake-tier strength can therefore be
--                      rebalanced from the BO alone.
--
--   target_rtp_pct   — Designer's target RTP for this tier (default
--                      90). Not used as an input by the payout math —
--                      operators set W/L manually — but the upcoming
--                      RTP dashboard compares actual vs target per
--                      tier, and the column is the source of truth for
--                      that comparison.
--
-- We also reseed the 5 difficulty rows with the W/L numbers locked
-- during the economy review (see the chat log). The on-conflict
-- upsert means a re-run of this migration in dev refreshes the seed
-- but is a no-op against rows the BO has since hand-edited if their
-- IDs match the seed (the operator's edits win for fields not listed).

alter table public.table_configs
  add column prize_coins_loss int not null default 0
    check (prize_coins_loss >= 0),
  add column ai_level text not null default 'medium'
    check (ai_level in ('easy', 'medium', 'hard')),
  add column target_rtp_pct int not null default 90
    check (target_rtp_pct between 0 and 200);

comment on column public.table_configs.prize_coins_loss is
  'Coins refunded to the match owner on a loss. Pairs with prize_coins (win). Together with entry_fee_coins drives RTP at the assumed win probability.';
comment on column public.table_configs.ai_level is
  'AI strength this tier uses. enter_room maps this to match.mode as ai-<level>; the win-streak escalator can bump one step harder for streaking players.';
comment on column public.table_configs.target_rtp_pct is
  'Designer''s RTP target for this tier (percent). Used by the BO dashboard to compare actual vs target; not consumed by the runtime math.';

update public.table_configs
set entry_fee_coins = 1000,
    prize_coins = 1300,
    prize_coins_loss = 300,
    ai_level = 'easy',
    target_rtp_pct = 90,
    updated_at = now()
where id = 'difficulty-beginner';

update public.table_configs
set entry_fee_coins = 2500,
    prize_coins = 3500,
    prize_coins_loss = 800,
    ai_level = 'easy',
    target_rtp_pct = 90,
    updated_at = now()
where id = 'difficulty-advanced';

update public.table_configs
set entry_fee_coins = 10000,
    prize_coins = 15000,
    prize_coins_loss = 3000,
    ai_level = 'medium',
    target_rtp_pct = 90,
    updated_at = now()
where id = 'difficulty-pro';

update public.table_configs
set entry_fee_coins = 50000,
    prize_coins = 80000,
    prize_coins_loss = 15000,
    ai_level = 'medium',
    target_rtp_pct = 90,
    updated_at = now()
where id = 'difficulty-expert';

update public.table_configs
set entry_fee_coins = 150000,
    prize_coins = 270000,
    prize_coins_loss = 45000,
    ai_level = 'hard',
    target_rtp_pct = 90,
    updated_at = now()
where id = 'difficulty-grand-master';
