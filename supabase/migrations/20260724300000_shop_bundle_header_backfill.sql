-- Bundle card header is becoming optional + colour-configurable (contents
-- .presentation.header = { text, bg, fg }). The storefront now renders the gold
-- title plate ONLY when header.text is set. To keep existing featured bundles
-- looking identical after that ships, backfill header.text from display_name for
-- any bundle/featured item that doesn't already have one. Merge-based so it
-- creates the presentation/header objects if missing and preserves sibling keys
-- (ribbon, rewards, headlineKind, placement, …). Idempotent via the guard.
update public.shop_items
set contents = coalesce(contents, '{}'::jsonb)
  || jsonb_build_object(
       'presentation',
       coalesce(contents -> 'presentation', '{}'::jsonb)
         || jsonb_build_object(
              'header',
              coalesce(contents #> '{presentation,header}', '{}'::jsonb)
                || jsonb_build_object('text', display_name)
            )
     )
where (kind = 'bundle' or contents #>> '{presentation,placement}' = 'featured')
  and (contents #> '{presentation,header,text}') is null;
