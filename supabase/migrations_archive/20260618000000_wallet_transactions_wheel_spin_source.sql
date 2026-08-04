-- Allow 'wheel_spin' as a wallet_transactions.source value.
--
-- spin_wheel inserts a wallet_transactions row to ledger the
-- credited coins so the BO RTP dashboard and per-player wallet
-- history surface the hourly-wheel payouts as a distinct source
-- (separate from match rewards, daily bonus, etc). Without this
-- check-constraint extension, every spin RPC fails with:
--   new row for relation "wallet_transactions" violates check
--   constraint "wallet_transactions_source_check"
--
-- This migration is purely additive — it re-declares the constraint
-- to include the same list as 20260529000000_enter_room.sql plus
-- 'wheel_spin'. No data backfill or column change required.

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_source_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_source_check
  check (source in (
    'admin_adjustment', 'match_reward', 'purchase', 'daily_bonus',
    'level_reward', 'refund', 'system', 'entry_fee', 'wheel_spin'
  ));
