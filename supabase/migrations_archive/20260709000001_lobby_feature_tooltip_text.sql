-- Per-feature custom tooltip text for bottom-nav locks.
--
-- When set, a locked feature's pop-up tooltip shows this text verbatim (e.g.
-- "Coming soon") instead of the default "Reach level N to unlock". Null/blank
-- falls back to the level-based default, so this column is a no-op until an
-- operator fills it in. Editable in the Back Office (Lobby Features).

alter table public.lobby_feature_configs
  add column if not exists tooltip_text text;
