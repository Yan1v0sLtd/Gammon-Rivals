-- One-off RECOVERY SCRIPT. Not a migration.
--
-- Background: the user accidentally re-ran the
-- 20260512130413_board_theme_admin_write_policy.sql migration in
-- Studio's SQL editor. The terminating upsert
--
--   insert into public.board_theme_configs (...) values (...)
--   on conflict (id) do update set
--     display_name = excluded.display_name,
--     preview_image = excluded.preview_image,
--     gameplay_image = excluded.gameplay_image,
--     lobby_background_image = excluded.lobby_background_image,
--     unlock_level = excluded.unlock_level,
--     price_coins = excluded.price_coins,
--     is_enabled = excluded.is_enabled,
--     is_featured = excluded.is_featured,
--     sort_order = excluded.sort_order,
--     metadata = excluded.metadata;
--
-- …overwrote the three default boards (classic-green / ocean-blue /
-- royal-purple) with the file's hardcoded defaults — clobbering
-- every BO edit the operator had made on those rows since the
-- original migration ran.
--
-- The board_theme_configs_audit_log trigger (defined in
-- 20260511140413_admin_foundation.sql line 481) captures the FULL
-- before-row as jsonb on every UPDATE. We replay the MOST RECENT
-- `update` audit row's `before_value` back onto each affected row,
-- restoring the operator's pre-accident state.
--
-- Columns NOT touched by the accident (price_gems, white_checker_
-- image, black_checker_image, dice_image, tray_image, holder_image,
-- created_at, updated_at) are left as-is — we only overwrite the
-- ten columns the accident wrote.
--
-- Paste this whole block into Studio's SQL editor:
--   https://supabase.com/dashboard/project/vekgsukccluwaqdlqpzj/sql/new
-- Run once. It will RAISE NOTICE for each row it restores or skips.

do $$
declare
  target_id text;
  before_row jsonb;
  audit_age interval;
  restored_count int := 0;
  skipped_count int := 0;
begin
  for target_id in
    select unnest(array['classic-green', 'ocean-blue', 'royal-purple'])
  loop
    -- Most recent UPDATE audit row for this board id — its
    -- before_value is the state at the moment of the accidental
    -- upsert (assuming you've only run it once).
    select before_value, now() - created_at
      into before_row, audit_age
    from public.admin_audit_log
    where entity_table = 'board_theme_configs'
      and entity_id = target_id
      and action = 'update'
    order by created_at desc
    limit 1;

    if before_row is null then
      raise notice 'No update audit row found for "%", skipping.', target_id;
      skipped_count := skipped_count + 1;
      continue;
    end if;

    raise notice 'Restoring "%" from audit snapshot taken % ago.', target_id, audit_age;

    update public.board_theme_configs
       set
         display_name           = before_row ->> 'display_name',
         preview_image          = before_row ->> 'preview_image',
         gameplay_image         = before_row ->> 'gameplay_image',
         lobby_background_image = before_row ->> 'lobby_background_image',
         unlock_level           = (before_row ->> 'unlock_level')::int,
         price_coins            = (before_row ->> 'price_coins')::int,
         is_enabled             = (before_row ->> 'is_enabled')::boolean,
         is_featured            = (before_row ->> 'is_featured')::boolean,
         sort_order             = (before_row ->> 'sort_order')::int,
         metadata               = before_row -> 'metadata'
     where id = target_id;

    restored_count := restored_count + 1;
  end loop;

  raise notice '────────────────────────────────────────';
  raise notice 'Recovery summary: % restored, % skipped.', restored_count, skipped_count;
  raise notice 'Verify in the BO Board Themes section. The recovery';
  raise notice 'itself triggers a NEW audit-log row (action=update,';
  raise notice 'before=accident-defaults, after=restored), so this';
  raise notice 'script is one-shot — re-running it would replay the';
  raise notice 'accident defaults back on top of your recovered row.';
end;
$$;
