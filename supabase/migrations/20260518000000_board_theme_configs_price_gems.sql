-- Adds a per-board gem-purchase price so the lobby can mark boards as
-- purchasable with the player's gem balance. 0 means no gem purchase
-- is offered (player still gets the board through level_reward,
-- bundle, default, or admin_grant sources in user_board_inventory).
-- Independent of unlock_level: a board may require a minimum level
-- AND a gem purchase to unlock.

alter table public.board_theme_configs
  add column if not exists price_gems integer not null default 0 check (price_gems >= 0);

comment on column public.board_theme_configs.price_gems is
  'Cost in gems to unlock this board theme. 0 = no gem purchase available. Players must also satisfy unlock_level before they can purchase.';
