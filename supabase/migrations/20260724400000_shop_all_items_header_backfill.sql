-- The optional/colour-configurable card header now applies to ALL shop items
-- (packs too, not just featured bundles — 20260724300000 covered bundles only).
-- The storefront renders the gold title plate ONLY when header.text is set, so
-- backfill header.text = display_name for every item that still lacks one, to
-- preserve the current look (each pack shows its name today). Merge-based +
-- idempotent via the guard; the bundle backfilled earlier is skipped.
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
where (contents #> '{presentation,header,text}') is null;
