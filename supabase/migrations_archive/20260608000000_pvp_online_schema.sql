-- PvP online matchmaking schema layer.
--
-- The default game-entry path is now PvP-first: tap PLAY on a
-- difficulty tier, the system finds an opponent within an ELO band,
-- and falls back to an AI (whose strength is driven by the player's
-- pvp_rating, not the tier's ai_level) after a short search timeout.
-- That story needs three small schema additions.
--
-- 1. profiles.pvp_rating — Independent of the existing profiles.rating
--    column (which tracks ELO against the AI). pvp_rating only moves
--    when the player completes a PvP match (both human owner + human
--    opponent). Starts at 1500 — standard ELO neutral — so new players
--    get matched against other new players.
--
-- 2. table_configs.allow_online_pvp — Operator switch. When true, the
--    tier shows up in the matchmaking pool; when false, PLAY skips
--    straight to the AI flow without searching. Lets us launch tiers
--    in AI-only mode and turn on PvP once the population is dense
--    enough to find opponents reliably.
--
-- 3. matchmaking_queue.table_config_id — The legacy queue paired by
--    `target` (match length) alone; with tier-driven matchmaking we
--    pair by tier first (entry fee + payout shape + turn timer), then
--    by ELO band within the tier. Adding the column nullable keeps the
--    existing public-lobby flow working until we sunset it.
--
-- All three changes default cleanly so the rollout is a pure expand —
-- no breaking change to either the live PvP flow or the AI flow we
-- just shipped.

alter table public.profiles
  add column pvp_rating int not null default 1500
    check (pvp_rating >= 0 and pvp_rating <= 4000);

comment on column public.profiles.pvp_rating is
  'ELO-style PvP rating. Moves only on PvP match completion (both sides human). 1500 = neutral starting rating; clamps at [0, 4000] so a broken update can''t corrupt the column.';

alter table public.table_configs
  add column allow_online_pvp boolean not null default false;

comment on column public.table_configs.allow_online_pvp is
  'Operator switch: if true, the tier participates in PvP matchmaking. If false, every PLAY goes straight to AI without a search.';

alter table public.matchmaking_queue
  add column table_config_id text references public.table_configs(id) on delete cascade;

create index if not exists matchmaking_queue_tier_search_idx
  on public.matchmaking_queue (table_config_id, rating)
  where matched_match_id is null;

comment on column public.matchmaking_queue.table_config_id is
  'The tier this caller is searching within. Null entries belong to the legacy public-lobby matchmake flow; tier-aware searches via find_match_in_tier set this so the queue can pair by tier+ELO rather than just target.';

-- Enable PvP on the five difficulty tiers we seeded earlier. Coin packs,
-- practice rooms, etc. (kind <> 'difficulty') stay false until an
-- operator opts them in.
update public.table_configs
set allow_online_pvp = true,
    updated_at = now()
where kind = 'difficulty';
