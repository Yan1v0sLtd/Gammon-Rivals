SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."shop_items"
(
  "id"                     "text"                                         NOT NULL,
  "kind"                   "text"                                         NOT NULL,
  "display_name"           "text"                                         NOT NULL,
  "description"            "text"                   DEFAULT ''::"text"    NOT NULL,
  "image_url"              "text",
  "price_cents"            integer,
  "price_coins"            integer,
  "price_gems"             integer,
  "apple_product_id"       "text",
  "google_product_id"      "text",
  "contents"               "jsonb"                  DEFAULT '{}'::"jsonb" NOT NULL,
  "visibility_rules"       "jsonb"                  DEFAULT '{}'::"jsonb" NOT NULL,
  "starts_at"              timestamp with time zone,
  "ends_at"                timestamp with time zone,
  "max_purchases_per_user" integer,
  "is_enabled"             boolean                  DEFAULT false         NOT NULL,
  "sort_order"             integer                  DEFAULT 0             NOT NULL,
  "updated_by"             "uuid",
  "created_at"             timestamp with time zone DEFAULT "now"()       NOT NULL,
  "updated_at"             timestamp with time zone DEFAULT "now"()       NOT NULL,
  "exclude_from_sale"      boolean                  DEFAULT false         NOT NULL,
  CONSTRAINT "shop_items_contents_check" CHECK (("jsonb_typeof"("contents") = 'object'::"text")),
  CONSTRAINT "shop_items_google_product_id_format" CHECK ((("google_product_id" IS NULL) OR
                                                           ("google_product_id" ~ '^[a-z0-9][a-z0-9_.]*$'::"text"))),
  CONSTRAINT "shop_items_id_check" CHECK (("id" ~ '^[a-z0-9][a-z0-9_-]*$'::"text")),
  CONSTRAINT "shop_items_kind_check" CHECK (("kind" = ANY
                                             (ARRAY ['coin_pack'::"text", 'gem_pack'::"text", 'board_theme'::"text", 'cosmetic'::"text", 'bundle'::"text", 'special_offer'::"text"]))),
  CONSTRAINT "shop_items_max_purchases_per_user_check" CHECK ((("max_purchases_per_user" IS NULL) OR ("max_purchases_per_user" > 0))),
  CONSTRAINT "shop_items_price_cents_check" CHECK ((("price_cents" IS NULL) OR ("price_cents" >= 0))),
  CONSTRAINT "shop_items_price_coins_check" CHECK ((("price_coins" IS NULL) OR ("price_coins" >= 0))),
  CONSTRAINT "shop_items_price_gems_check" CHECK ((("price_gems" IS NULL) OR ("price_gems" >= 0))),
  CONSTRAINT "shop_items_visibility_rules_check" CHECK (("jsonb_typeof"("visibility_rules") = 'object'::"text"))
);


ALTER TABLE "public"."shop_items"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."shop_items"."exclude_from_sale" IS 'When true, an active Store Sale does NOT boost this item''s coin/gem grants.';



CREATE TABLE IF NOT EXISTS "public"."user_wallets"
(
  "profile_id" "uuid"                                   NOT NULL,
  "coins"      integer                  DEFAULT 0       NOT NULL,
  "gems"       integer                  DEFAULT 0       NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "user_wallets_coins_check" CHECK (("coins" >= 0)),
  CONSTRAINT "user_wallets_gems_check" CHECK (("gems" >= 0))
);


ALTER TABLE "public"."user_wallets"
  OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."apply_shop_grants_and_record"("p_profile_id" "uuid",
                                                                    "p_item" "public"."shop_items", "p_provider" "text",
                                                                    "p_txn" "text") RETURNS "public"."user_wallets"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  grants_obj     jsonb;
  grant_key      text;
  allowed_grants text[] := array ['coins', 'gems', 'boardThemeId', 'xpBoost'];
  wallet_row     public.user_wallets;
  grant_coins    int;
  grant_gems     int;
  grant_board_id text;
  xp_boost_obj   jsonb;
  xp_boost_days  int;
  xp_boost_mult  int;
  sale_bonus     int    := 0;
  reason_label   text   := coalesce(p_item.display_name, p_item.id);
begin
  grants_obj := coalesce(p_item.contents -> 'grants', '{}'::jsonb);

  for grant_key in select jsonb_object_keys(grants_obj)
    loop
      if not (grant_key = any (allowed_grants)) then
        raise exception 'unsupported_grant: %', grant_key;
      end if;
    end loop;

  if grants_obj ? 'xpBoost' then
    xp_boost_obj := grants_obj -> 'xpBoost';
    if jsonb_typeof(xp_boost_obj) <> 'object' then
      raise exception 'invalid_xp_boost_grant';
    end if;
    xp_boost_days := coalesce((xp_boost_obj ->> 'days')::int, 0);
    xp_boost_mult := coalesce((xp_boost_obj ->> 'multiplier')::int, 0);
    if xp_boost_days <= 0 or xp_boost_mult < 2 or xp_boost_mult > 10 then
      raise exception 'invalid_xp_boost_grant';
    end if;
  end if;

  if grants_obj ? 'boardThemeId' then
    if exists (select 1
               from public.user_board_inventory
               where profile_id = p_profile_id
                 and board_theme_id = grants_obj ->> 'boardThemeId') then
      raise exception 'already_owned_board';
    end if;
  end if;

  insert into public.user_wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;
  select * into wallet_row from public.user_wallets where profile_id = p_profile_id;

  grant_coins := coalesce((grants_obj ->> 'coins')::int, 0);
  grant_gems := coalesce((grants_obj ->> 'gems')::int, 0);
  grant_board_id := grants_obj ->> 'boardThemeId';

  sale_bonus := private.effective_store_sale_bonus();
  if sale_bonus > 0 and not coalesce(p_item.exclude_from_sale, false) then
    grant_coins := round(grant_coins * (1 + sale_bonus / 100.0));
    grant_gems := round(grant_gems * (1 + sale_bonus / 100.0));
  end if;

  if grant_coins > 0 then
    update public.user_wallets
    set coins = coins + grant_coins
    where profile_id = p_profile_id
    returning * into wallet_row;
    insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values (p_profile_id, 'coins', grant_coins, wallet_row.coins, 'purchase',
            'Shop grant: ' || reason_label,
            jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider, 'sale_bonus_percent', sale_bonus),
            p_profile_id);
  end if;

  if grant_gems > 0 then
    update public.user_wallets
    set gems = gems + grant_gems
    where profile_id = p_profile_id
    returning * into wallet_row;
    insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values (p_profile_id, 'gems', grant_gems, wallet_row.gems, 'purchase',
            'Shop grant: ' || reason_label,
            jsonb_build_object('shop_item_id', p_item.id, 'provider', p_provider, 'sale_bonus_percent', sale_bonus),
            p_profile_id);
  end if;

  if grant_board_id is not null then
    insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
    values (p_profile_id, grant_board_id, 'purchase', p_profile_id);
  end if;

  if grants_obj ? 'xpBoost' then
    insert into public.user_xp_boosts (profile_id, multiplier, expires_at, source, shop_item_id)
    values (p_profile_id, xp_boost_mult, now() + (xp_boost_days || ' days')::interval,
            'purchase', p_item.id);
  end if;

  insert into public.purchases
  (profile_id, product_id, product_type, provider, provider_transaction_id, price_cents, contents, status)
  values (p_profile_id, p_item.id, p_item.kind, p_provider, p_txn, p_item.price_cents,
          coalesce(p_item.contents, '{}'::jsonb) || jsonb_build_object('sale_bonus_percent', sale_bonus), 'completed');

  return wallet_row;
end;
$$;


ALTER FUNCTION "private"."apply_shop_grants_and_record"("p_profile_id" "uuid", "p_item" "public"."shop_items", "p_provider" "text", "p_txn" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assert_shop_item_purchasable"("p_profile_id" "uuid", "p_item" "public"."shop_items") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  prior_count int;
begin
  if not p_item.is_enabled then raise exception 'item_disabled'; end if;
  if p_item.starts_at is not null and now() < p_item.starts_at then raise exception 'item_not_yet_available'; end if;
  if p_item.ends_at is not null and now() > p_item.ends_at then raise exception 'item_expired'; end if;
  if p_item.max_purchases_per_user is not null then
    select count(*)
    into prior_count
    from public.purchases
    where profile_id = p_profile_id
      and product_id = p_item.id
      and status = 'completed'
      and provider <> 'test';
    if prior_count >= p_item.max_purchases_per_user then raise exception 'purchase_limit_reached'; end if;
  end if;
end;
$$;


ALTER FUNCTION "private"."assert_shop_item_purchasable"("p_profile_id" "uuid", "p_item" "public"."shop_items") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_config"("check_profile_id" "uuid") RETURNS boolean
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select exists (select 1
               from public.admin_roles
               where profile_id = check_profile_id
                 and role in ('owner', 'admin'));
$$;


ALTER FUNCTION "private"."can_manage_config"("check_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_admin_role"() RETURNS "text"
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
with candidates as (select role
                    from public.admin_roles
                    where profile_id = auth.uid()

                    union all

                    select role
                    from public.admin_email_allowlist
                    where email = lower(coalesce(auth.jwt() ->> 'email', '')))
select role
from candidates
order by case role
           when 'owner' then 1
           when 'admin' then 2
           when 'support' then 3
           when 'viewer' then 4
           else 5
           end
limit 1;
$$;


ALTER FUNCTION "private"."current_admin_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."effective_store_sale_bonus"() RETURNS integer
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select coalesce((select bonus_percent
                 from public.store_sales
                 where is_active
                   and (starts_at is null or starts_at <= now())
                   and (ends_at is null or ends_at >= now())
                 order by updated_at desc
                 limit 1), 0);
$$;


ALTER FUNCTION "private"."effective_store_sale_bonus"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ensure_user_daily_bonus"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  insert into public.user_daily_bonuses (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "private"."ensure_user_daily_bonus"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ensure_user_wallet"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  insert into public.user_wallets (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  perform public.apply_economy_grant(new.id, 'signup');

  return new;
end;
$$;


ALTER FUNCTION "private"."ensure_user_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_admin"("check_profile_id" "uuid") RETURNS boolean
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select private.current_admin_role() in ('owner', 'admin', 'support', 'viewer');
$$;


ALTER FUNCTION "private"."is_admin"("check_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."log_admin_config_change"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  before_row jsonb;
  after_row  jsonb;
  target_id  text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    before_row := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    after_row := to_jsonb(new);
  end if;

  target_id := coalesce(
    after_row ->> 'id',
    after_row ->> 'profile_id',
    after_row ->> 'level',
    before_row ->> 'id',
    before_row ->> 'profile_id',
    before_row ->> 'level',
    ''
               );

  insert into public.admin_audit_log
  (actor_profile_id, action, entity_table, entity_id, before_value, after_value)
  values (auth.uid(), lower(tg_op), tg_table_name, target_id, before_row, after_row);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."log_admin_config_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."touch_currency_configs_updated_at"() RETURNS "trigger"
  LANGUAGE "plpgsql"
AS
$$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "private"."touch_currency_configs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer DEFAULT 60) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id       uuid := auth.uid();
  match_rec       record;
  abandoned_count int  := 0;
  cap_minutes     int  := greatest(coalesce(p_max_age_minutes, 60), 1);
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  for match_rec in
    select id, owner_color
    from public.matches
    where owner_id = caller_id
      and finished_at is null
      and table_config_id is not null
      and started_at < now() - (cap_minutes || ' minutes')::interval
    loop
      begin
        perform public.finish_match(
          match_rec.id,
          0,
          0,
          case when match_rec.owner_color = 'white' then 'black' else 'white' end,
          null
                );
        abandoned_count := abandoned_count + 1;
      exception
        when others then
          continue;
      end;
    end loop;

  return jsonb_build_object(
    'abandoned_count', abandoned_count,
    'max_age_minutes', cap_minutes
         );
end;
$$;


ALTER FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer) IS 'Finalises any caller-owned difficulty-room matches older than p_max_age_minutes that never reached finished_at. Each is marked as a loss via finish_match, so the lose-prize / risk-free-intro logic applies and the RTP dashboard data stays honest. Returns jsonb {abandoned_count, max_age_minutes}.';



CREATE OR REPLACE FUNCTION "public"."admin_adjust_wallet"("target_profile_id" "uuid", "currency_code" "text",
                                                          "delta_amount" integer,
                                                          "adjustment_reason" "text") RETURNS "public"."user_wallets"
  LANGUAGE "plpgsql"
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  wallet_row  public.user_wallets;
  new_balance int;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'admin_required';
  end if;

  if currency_code not in ('coins', 'gems') then
    raise exception 'invalid_currency';
  end if;

  if delta_amount = 0 then
    raise exception 'amount_must_not_be_zero';
  end if;

  if trim(coalesce(adjustment_reason, '')) = '' then
    raise exception 'reason_required';
  end if;

  insert into public.user_wallets (profile_id)
  values (target_profile_id)
  on conflict (profile_id) do nothing;

  if currency_code = 'coins' then
    update public.user_wallets
    set coins = coins + delta_amount
    where profile_id = target_profile_id
      and coins + delta_amount >= 0
    returning * into wallet_row;
    new_balance := wallet_row.coins;
  else
    update public.user_wallets
    set gems = gems + delta_amount
    where profile_id = target_profile_id
      and gems + delta_amount >= 0
    returning * into wallet_row;
    new_balance := wallet_row.gems;
  end if;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_balance';
  end if;

  insert into public.wallet_transactions
  (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
  values (target_profile_id, currency_code, delta_amount, new_balance, 'admin_adjustment', adjustment_reason,
          '{}'::jsonb, auth.uid());

  return wallet_row;
end;
$$;


ALTER FUNCTION "public"."admin_adjust_wallet"("target_profile_id" "uuid", "currency_code" "text", "delta_amount" integer, "adjustment_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'auth', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1
                 from public.admin_roles
                 where profile_id = caller_id
                   and role in ('owner', 'admin')) then
    raise exception 'admin_required';
  end if;

  if target_id = caller_id then
    raise exception 'cannot_delete_self';
  end if;

  update public.matches
  set opponent_id = null
  where opponent_id = target_id;

  delete from auth.users where id = target_id;
end;
$$;


ALTER FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") IS 'Hard-delete a user. SECURITY DEFINER, owner/admin only, cannot self-delete. Nulls matches.opponent_id then deletes auth.users (cascades to profiles + all player_* / user_* tables). Used by the Back Office to purge test/shell users that pile up during dev. Raises: not_authenticated, admin_required, cannot_delete_self.';



CREATE OR REPLACE FUNCTION "public"."admin_refresh_player_missions"("p_email" "text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  v_profile_id uuid;
  v_deleted    int;
  v_assigned   int;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select u.id
  into v_profile_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
  if v_profile_id is null then
    raise exception 'no_user_for_email';
  end if;

  with deleted as (
    delete from public.player_daily_missions
      where profile_id = v_profile_id and period = 'daily' and expires_at > now()
      returning 1)
  select count(*)
  into v_deleted
  from deleted;

  v_assigned := public.assign_daily_missions_for_profile(v_profile_id);

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'deleted', v_deleted,
    'assigned', v_assigned
         );
end;
$$;


ALTER FUNCTION "public"."admin_refresh_player_missions"("p_email" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."currency_configs"
(
  "code"             "text"                                   NOT NULL,
  "display_name"     "text"                                   NOT NULL,
  "usd_value_micros" bigint                                   NOT NULL,
  "is_enabled"       boolean                  DEFAULT true    NOT NULL,
  "sort_order"       integer                  DEFAULT 0       NOT NULL,
  "updated_by"       "uuid",
  "created_at"       timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at"       timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "currency_configs_code_check" CHECK (("code" ~ '^[a-z][a-z0-9_]*$'::"text")),
  CONSTRAINT "currency_configs_usd_value_micros_check" CHECK (("usd_value_micros" >= 0))
);


ALTER TABLE "public"."currency_configs"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."currency_configs" IS 'USD value per in-game currency. Source of truth for $ / EV displays in the Back Office. Writes go through admin_upsert_currency_config only.';



COMMENT ON COLUMN "public"."currency_configs"."usd_value_micros" IS 'USD value of one unit in micros (USD × 1_000_000). Example: 1 gem = $0.01 → 10000.';



CREATE OR REPLACE FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text",
                                                                   "p_usd_value_micros" bigint, "p_is_enabled" boolean,
                                                                   "p_sort_order" integer) RETURNS "public"."currency_configs"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$_$
declare
  caller_id uuid := auth.uid();
  result    public.currency_configs;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.can_manage_config(caller_id) then
    raise exception 'admin_required';
  end if;
  if p_usd_value_micros < 0 then
    raise exception 'usd_value_must_be_non_negative';
  end if;
  if p_code !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid_currency_code';
  end if;

  insert into public.currency_configs (code, display_name, usd_value_micros, is_enabled, sort_order, updated_by,
                                       updated_at)
  values (p_code, p_display_name, p_usd_value_micros, p_is_enabled, p_sort_order, caller_id, now())
  on conflict (code) do update set display_name     = excluded.display_name,
                                   usd_value_micros = excluded.usd_value_micros,
                                   is_enabled       = excluded.is_enabled,
                                   sort_order       = excluded.sort_order,
                                   updated_by       = caller_id,
                                   updated_at       = now()
  returning * into result;

  return result;
end;
$_$;


ALTER FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text", "p_usd_value_micros" bigint, "p_is_enabled" boolean, "p_sort_order" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text", "p_usd_value_micros" bigint, "p_is_enabled" boolean, "p_sort_order" integer) IS 'Upsert a currency_configs row. Owner/admin only via private.can_manage_config. Used by the Back Office Currencies section. Raises: not_authenticated, admin_required, usd_value_must_be_non_negative, invalid_currency_code.';



CREATE TABLE IF NOT EXISTS "public"."economy_grants"
(
  "trigger_key"  "text"                                      NOT NULL,
  "display_name" "text"                                      NOT NULL,
  "description"  "text"                   DEFAULT ''::"text" NOT NULL,
  "coins"        integer                  DEFAULT 0          NOT NULL,
  "gems"         integer                  DEFAULT 0          NOT NULL,
  "one_time"     boolean                  DEFAULT true       NOT NULL,
  "is_enabled"   boolean                  DEFAULT true       NOT NULL,
  "sort_order"   integer                  DEFAULT 0          NOT NULL,
  "updated_by"   "uuid",
  "created_at"   timestamp with time zone DEFAULT "now"()    NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT "now"()    NOT NULL,
  CONSTRAINT "economy_grants_coins_check" CHECK (("coins" >= 0)),
  CONSTRAINT "economy_grants_display_name_check" CHECK (("length"(TRIM(BOTH FROM "display_name")) > 0)),
  CONSTRAINT "economy_grants_gems_check" CHECK (("gems" >= 0)),
  CONSTRAINT "economy_grants_trigger_key_check" CHECK (("trigger_key" ~ '^[a-z][a-z0-9_]*$'::"text"))
);


ALTER TABLE "public"."economy_grants"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."economy_grants" IS 'Catalog of coin/gem grant rules keyed by trigger (signup, link_google, refer_friend, …). The Back Office edits these; apply_economy_grant() consumes them. one_time gates whether a player can receive the grant more than once.';



CREATE OR REPLACE FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text",
                                                                 "p_description" "text", "p_coins" integer,
                                                                 "p_gems" integer, "p_one_time" boolean,
                                                                 "p_is_enabled" boolean,
                                                                 "p_sort_order" integer) RETURNS "public"."economy_grants"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$_$
declare
  caller_id uuid := auth.uid();
  result    public.economy_grants;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.can_manage_config(caller_id) then
    raise exception 'admin_required';
  end if;
  if p_trigger_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid_trigger_key';
  end if;
  if coalesce(p_coins, 0) < 0 or coalesce(p_gems, 0) < 0 then
    raise exception 'amounts_must_be_non_negative';
  end if;

  insert into public.economy_grants (trigger_key, display_name, description, coins, gems,
                                     one_time, is_enabled, sort_order, updated_by, updated_at)
  values (p_trigger_key, p_display_name, coalesce(p_description, ''),
          coalesce(p_coins, 0), coalesce(p_gems, 0),
          coalesce(p_one_time, true), coalesce(p_is_enabled, true),
          coalesce(p_sort_order, 0), caller_id, now())
  on conflict (trigger_key) do update set display_name = excluded.display_name,
                                          description  = excluded.description,
                                          coins        = excluded.coins,
                                          gems         = excluded.gems,
                                          one_time     = excluded.one_time,
                                          is_enabled   = excluded.is_enabled,
                                          sort_order   = excluded.sort_order,
                                          updated_by   = caller_id,
                                          updated_at   = now()
  returning * into result;

  return result;
end;
$_$;


ALTER FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text", "p_description" "text", "p_coins" integer, "p_gems" integer, "p_one_time" boolean, "p_is_enabled" boolean, "p_sort_order" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text", "p_description" "text", "p_coins" integer, "p_gems" integer, "p_one_time" boolean, "p_is_enabled" boolean, "p_sort_order" integer) IS 'Upsert an economy_grants rule. Owner/admin only. Used by the Back Office Economy Grants section. Raises: not_authenticated, admin_required, invalid_trigger_key, amounts_must_be_non_negative.';



CREATE OR REPLACE FUNCTION "public"."apply_economy_grant"("p_profile_id" "uuid", "p_trigger_key" "text") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  rule         public.economy_grants;
  wallet_after public.user_wallets;
begin
  select *
  into rule
  from public.economy_grants
  where trigger_key = p_trigger_key
    and is_enabled;
  if not found then
    return;
  end if;

  if rule.one_time and exists (select 1
                               from public.player_grants
                               where profile_id = p_profile_id
                                 and trigger_key = p_trigger_key) then
    return;
  end if;

  if rule.coins > 0 or rule.gems > 0 then
    insert into public.user_wallets (profile_id)
    values (p_profile_id)
    on conflict (profile_id) do nothing;

    update public.user_wallets
    set coins = coins + rule.coins,
        gems  = gems + rule.gems
    where profile_id = p_profile_id
    returning * into wallet_after;

    if rule.coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (p_profile_id, 'coins', rule.coins, coalesce(wallet_after.coins, 0),
              'system', rule.display_name,
              jsonb_build_object('grant_trigger', p_trigger_key), null);
    end if;
    if rule.gems > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (p_profile_id, 'gems', rule.gems, coalesce(wallet_after.gems, 0),
              'system', rule.display_name,
              jsonb_build_object('grant_trigger', p_trigger_key), null);
    end if;
  end if;

  insert into public.player_grants (profile_id, trigger_key, coins, gems)
  values (p_profile_id, p_trigger_key, rule.coins, rule.gems);
end;
$$;


ALTER FUNCTION "public"."apply_economy_grant"("p_profile_id" "uuid", "p_trigger_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_economy_grant"("p_profile_id" "uuid", "p_trigger_key" "text") IS 'Apply the economy_grants rule for p_trigger_key to a player: credits coins/gems, logs wallet_transactions, records player_grants. Respects one_time. SECURITY DEFINER and revoked from client roles — call only from server-side triggers/functions to prevent grant farming.';



CREATE OR REPLACE FUNCTION "public"."assign_daily_missions_for_all"() RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  prof_id uuid;
  total   int := 0;
begin
  for prof_id in
    select id
    from public.profiles
    where not coalesce(is_suspended, false)
      and not coalesce(is_guest, false)
    loop
      total := total + public.assign_daily_missions_for_profile(prof_id);
    end loop;
  return total;
end;
$$;


ALTER FUNCTION "public"."assign_daily_missions_for_all"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_daily_missions_for_all"() IS 'pg_cron entrypoint: loops over active non-guest profiles and assigns the daily/weekly slate.';



CREATE OR REPLACE FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  prof            public.profiles;
  template_row    public.mission_templates;
  baseline        numeric;
  v_resolved_goal int;
  v_reward_coins  int;
  now_utc         timestamptz := now();
  day_end         timestamptz := (current_date + interval '1 day')::timestamptz;
  week_end        timestamptz := (date_trunc('week', current_date) + interval '7 days')::timestamptz;
  is_monday_utc   boolean     := extract(isodow from current_date) = 1;
  slot_rarities   text[]      := array ['common', 'common', 'rare', 'epic'];
  picked_ids      uuid[]      := array []::uuid[];
  picked_types    text[]      := array []::text[];
  i               int;
  assigned        int         := 0;
  v_ptype         text;
begin
  if auth.uid() is not null
    and p_profile_id <> auth.uid()
    and not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select *
  into prof
  from public.profiles
  where id = p_profile_id
    and not coalesce(is_suspended, false)
    and not coalesce(is_guest, false);
  if not found then return 0; end if;

  for v_ptype in
    select mission_type
    from public.mission_type_config
    where supports_personalized
      and rollout_pct > 0
      and (abs(hashtextextended(p_profile_id::text || ':' || mission_type, 0)) % 100) < rollout_pct
    order by mission_type
    loop
      if not exists (select 1
                     from public.player_daily_missions pdm
                            join public.mission_templates mt on mt.id = pdm.mission_template_id
                     where pdm.profile_id = p_profile_id
                       and mt.mission_type = v_ptype
                       and mt.resolution_mode = 'personalized'
                       and pdm.expires_at > now_utc) then
        perform public.mp_assign_personalized(p_profile_id, v_ptype);
        assigned := assigned + 1;
      end if;
    end loop;

  select coalesce(array_agg(pdm.mission_template_id), '{}'::uuid[]),
         coalesce(array_agg(mt.mission_type), '{}'::text[])
  into picked_ids, picked_types
  from public.player_daily_missions pdm
         join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and pdm.period = 'daily'
    and pdm.expires_at > now_utc;

  for i in 1..array_length(slot_rarities, 1)
    loop
      if (select count(*)
          from public.player_daily_missions pdm
          where pdm.profile_id = p_profile_id
            and pdm.rarity_slot = slot_rarities[i]
            and pdm.period = 'daily'
            and pdm.expires_at > now_utc) >=
         (case slot_rarities[i] when 'common' then 2 when 'rare' then 1 when 'epic' then 1 end)
      then
        continue;
      end if;

      select t.*
      into template_row
      from public.mission_templates t
      where t.enabled = true
        and t.period = 'daily'
        and t.rarity = slot_rarities[i]
        and t.resolution_mode <> 'personalized'
        and (t.eligibility ->> 'min_level' is null or (t.eligibility ->> 'min_level')::int <= prof.level)
        and (t.eligibility ->> 'max_level' is null or (t.eligibility ->> 'max_level')::int >= prof.level)
        and (
        not (t.eligibility ? 'requires_rated' and (t.eligibility ->> 'requires_rated')::boolean)
          or coalesce(prof.pvp_rating, 0) > 0
        )
        and t.id <> all (picked_ids)
      order by (t.mission_type = any (picked_types))::int asc,
               (exists (select 1
                        from public.player_daily_missions pdm
                        where pdm.profile_id = p_profile_id
                          and pdm.mission_template_id = t.id
                          and pdm.assigned_at > now_utc - interval '3 days'))::int asc,
               random()
      limit 1;

      if template_row.id is null then continue; end if;

      if template_row.resolution_mode = 'fixed' then
        v_resolved_goal := template_row.goal_value;
      else
        select pm.baseline_7d
        into baseline
        from public.player_metrics pm
        where pm.profile_id = p_profile_id
          and pm.metric_code = template_row.metric_code;
        baseline := coalesce(baseline, 0);
        v_resolved_goal := greatest(template_row.goal_min,
                                    least(template_row.goal_max,
                                          greatest(1, ceil(baseline * template_row.stretch_factor)::int)));
      end if;

      v_reward_coins := public.mp_cashback_reward(template_row, v_resolved_goal);

      insert into public.player_daily_missions
      (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at, reward_coins)
      values (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, day_end, 'daily', now_utc,
              v_reward_coins);

      picked_ids := picked_ids || template_row.id;
      picked_types := picked_types || template_row.mission_type;
      assigned := assigned + 1;
    end loop;

  if is_monday_utc then
    if not exists (select 1
                   from public.player_daily_missions pdm
                   where pdm.profile_id = p_profile_id
                     and pdm.period = 'weekly'
                     and pdm.expires_at > now_utc) then
      select t.*
      into template_row
      from public.mission_templates t
      where t.enabled = true
        and t.period = 'weekly'
        and t.resolution_mode <> 'personalized'
        and (t.eligibility ->> 'min_level' is null or (t.eligibility ->> 'min_level')::int <= prof.level)
        and (t.eligibility ->> 'max_level' is null or (t.eligibility ->> 'max_level')::int >= prof.level)
        and (
        not (t.eligibility ? 'requires_rated' and (t.eligibility ->> 'requires_rated')::boolean)
          or coalesce(prof.pvp_rating, 0) > 0
        )
      order by random()
      limit 1;
      if template_row.id is not null then
        if template_row.resolution_mode = 'fixed' then
          v_resolved_goal := template_row.goal_value;
        else
          select pm.baseline_7d
          into baseline
          from public.player_metrics pm
          where pm.profile_id = p_profile_id
            and pm.metric_code = template_row.metric_code;
          baseline := coalesce(baseline, 0);
          v_resolved_goal := greatest(template_row.goal_min,
                                      least(template_row.goal_max,
                                            greatest(1, ceil(baseline * template_row.stretch_factor)::int)));
        end if;
        v_reward_coins := public.mp_cashback_reward(template_row, v_resolved_goal);
        insert into public.player_daily_missions
        (profile_id, mission_template_id, rarity_slot, resolved_goal, expires_at, period, assigned_at, reward_coins)
        values (p_profile_id, template_row.id, template_row.rarity, v_resolved_goal, week_end, 'weekly', now_utc,
                v_reward_coins);
        assigned := assigned + 1;
      end if;
    end if;
  end if;

  return assigned;
end;
$$;


ALTER FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") IS 'Assigns 4-slot daily slate (1 Epic + 2 Common + 1 Rare) plus weekly mission on Mondays UTC. Safe to re-run mid-day. Returns count inserted.';



CREATE OR REPLACE FUNCTION "public"."bump_match_activity_on_move"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
begin
  update public.matches
  set updated_at = now()
  where id = (select match_id from public.games where id = new.game_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_match_activity_on_move"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_matchmaking"() RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not authenticated'; end if;
  delete
  from public.matchmaking_queue
  where profile_id = caller
    and matched_match_id is null;
end;
$$;


ALTER FUNCTION "public"."cancel_matchmaking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_chest"("p_milestone_index" integer) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id       uuid := auth.uid();
  milestone       public.chest_milestones;
  pass_row        public.player_weekly_pass;
  reward          record;
  wallet_row      public.user_wallets;
  profile_row     public.profiles;
  total_coins     int  := 0; total_gems int := 0; total_xp int := 0;
  v_week_key      text := to_char(now(), 'IYYY-"W"IW');
  already_claimed boolean;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into milestone from public.chest_milestones where milestone_index = p_milestone_index and enabled = true;
  if not found then raise exception 'milestone_not_found'; end if;
  select *
  into pass_row
  from public.player_weekly_pass
  where profile_id = caller_id
    and week_key = v_week_key for update;
  if not found then raise exception 'pass_not_started'; end if;
  if pass_row.mp_earned < milestone.threshold_mp then raise exception 'threshold_not_met'; end if;
  already_claimed :=
    exists (select 1 from jsonb_array_elements_text(pass_row.chests_claimed) e where e::int = p_milestone_index);
  if already_claimed then raise exception 'already_claimed'; end if;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  for reward in
    select reward_kind, currency_code, item_table, item_id, amount
    from public.chest_rewards
    where milestone_id = milestone.id
    order by display_order
    loop
      if reward.reward_kind = 'currency' then
        case reward.currency_code
          when 'coins' then total_coins := total_coins + reward.amount;
          when 'gems' then total_gems := total_gems + reward.amount;
          when 'xp' then total_xp := total_xp + reward.amount;
          else null;
          end case;
      elsif reward.reward_kind = 'item' then
        if reward.item_table = 'board_theme_configs' then
          insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
          values (caller_id, reward.item_id, 'chest_reward', caller_id)
          on conflict (profile_id, board_theme_id) do nothing;
        else
          insert into public.user_inventory (profile_id, item_table, item_id, source, source_ref_id)
          values (caller_id, reward.item_table, reward.item_id, 'chest_reward', milestone.id::text)
          on conflict (profile_id, item_table, item_id) do nothing;
        end if;
      end if;
    end loop;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins,
        gems  = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;
    if total_coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'coins', total_coins, wallet_row.coins, 'chest_reward',
              'Chest: ' || milestone.display_name,
              jsonb_build_object('milestone_index', p_milestone_index), caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'gems', total_gems, wallet_row.gems, 'chest_reward',
              'Chest: ' || milestone.display_name,
              jsonb_build_object('milestone_index', p_milestone_index), caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;
  if total_xp > 0 then
    update public.profiles set xp = xp + total_xp where id = caller_id returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  update public.player_weekly_pass
  set chests_claimed = chests_claimed || jsonb_build_array(p_milestone_index),
      updated_at     = now()
  where profile_id = caller_id
    and week_key = pass_row.week_key;

  return jsonb_build_object(
    'milestone_index', p_milestone_index, 'display_name', milestone.display_name,
    'credited_coins', total_coins, 'credited_gems', total_gems, 'credited_xp', total_xp,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
         );
end;
$$;


ALTER FUNCTION "public"."claim_chest"("p_milestone_index" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_chest"("p_milestone_index" integer) IS 'Claim a weekly-pass chest milestone.';



CREATE OR REPLACE FUNCTION "public"."claim_daily_bonus"() RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id       uuid := auth.uid();
  today_et        date := (now() at time zone 'America/New_York')::date;
  state_row       public.user_daily_bonuses;
  cfg_row         public.daily_bonus_configs;
  effective_day   int;
  next_day        int;
  wallet_row      public.user_wallets;
  profile_row     public.profiles;
  xp_mult         int;
  reward_xp_final int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.user_daily_bonuses (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  select *
  into state_row
  from public.user_daily_bonuses
  where profile_id = caller_id
    for update;

  if state_row.last_claim_date_et = today_et then
    raise exception 'already_claimed';
  end if;

  if state_row.last_claim_date_et is null
    or state_row.last_claim_date_et < today_et - 1 then
    effective_day := 1;
  else
    effective_day := state_row.current_day;
  end if;

  select *
  into cfg_row
  from public.daily_bonus_configs
  where day = effective_day;
  if not found then
    raise exception 'config_missing_for_day_%', effective_day;
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  update public.user_wallets
  set coins = coins + cfg_row.reward_coins,
      gems  = gems + cfg_row.reward_gems
  where profile_id = caller_id
  returning * into wallet_row;

  if cfg_row.reward_coins > 0 then
    insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                            created_by)
    values (caller_id,
            'coins',
            cfg_row.reward_coins,
            wallet_row.coins,
            'daily_bonus',
            'Daily bonus day ' || effective_day,
            jsonb_build_object('day', effective_day, 'date_et', today_et),
            caller_id);
  end if;

  if cfg_row.reward_gems > 0 then
    insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                            created_by)
    values (caller_id,
            'gems',
            cfg_row.reward_gems,
            wallet_row.gems,
            'daily_bonus',
            'Daily bonus day ' || effective_day,
            jsonb_build_object('day', effective_day, 'date_et', today_et),
            caller_id);
  end if;

  xp_mult := public.current_xp_multiplier(caller_id);
  reward_xp_final := cfg_row.reward_xp * xp_mult;
  if reward_xp_final > 0 then
    update public.profiles
    set xp = xp + reward_xp_final
    where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  next_day := (effective_day % 7) + 1;
  update public.user_daily_bonuses
  set current_day        = next_day,
      last_claim_date_et = today_et,
      last_claim_at      = now()
  where profile_id = caller_id;

  return jsonb_build_object(
    'day_claimed', effective_day,
    'reward_coins', cfg_row.reward_coins,
    'reward_gems', cfg_row.reward_gems,
    'reward_xp', reward_xp_final,
    'reward_xp_base', cfg_row.reward_xp,
    'xp_multiplier', xp_mult,
    'next_day', next_day,
    'claim_date_et', today_et,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
         );
end;
$$;


ALTER FUNCTION "public"."claim_daily_bonus"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_daily_bonus"() IS 'Atomic daily-bonus claim with XP-boost multiplier. Rolls over at midnight ET. Streak resets to day 1 after a missed day; cycles 7 -> 1 after day 7. Credits coins+gems via user_wallets, logs wallet_transactions (skips zero-amount rows), adds XP to profiles scaled by current_xp_multiplier(). Returns jsonb with day_claimed, reward_*, reward_xp_base, xp_multiplier, next_day, wallet, profile. Raises: not_authenticated, already_claimed, config_missing_for_day_N.';



CREATE OR REPLACE FUNCTION "public"."claim_mission"("p_mission_id" "uuid") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id       uuid := auth.uid();
  pdm             public.player_daily_missions;
  mt              public.mission_templates;
  reward          record;
  wallet_row      public.user_wallets;
  profile_row     public.profiles;
  total_coins     int  := 0;
  total_gems      int  := 0;
  total_xp        int  := 0;
  mp_award        int  := 0;
  v_week_key      text := to_char(now(), 'IYYY-"W"IW');
  unclaimed_today int;
  prior_streak    int;
  prior_last_date date;
  new_streak      int;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;

  select *
  into pdm
  from public.player_daily_missions
  where id = p_mission_id
    and profile_id = caller_id
    for update;

  if not found then raise exception 'mission_not_found'; end if;
  if pdm.completed_at is null then raise exception 'mission_not_complete'; end if;
  if pdm.claimed_at is not null then raise exception 'already_claimed'; end if;
  if pdm.expires_at <= now() then raise exception 'mission_expired'; end if;

  select * into mt from public.mission_templates where id = pdm.mission_template_id;

  if pdm.reward_coins is not null then
    total_coins := pdm.reward_coins;
  else
    for reward in
      select reward_kind, currency_code, item_table, item_id, amount
      from public.mission_rewards
      where mission_id = pdm.mission_template_id
      order by display_order
      loop
        if reward.reward_kind = 'currency' then
          case reward.currency_code
            when 'coins' then total_coins := total_coins + reward.amount;
            when 'gems' then total_gems := total_gems + reward.amount;
            when 'xp' then total_xp := total_xp + reward.amount;
            else null;
            end case;
        elsif reward.reward_kind = 'item' then
          if reward.item_table = 'board_theme_configs' then
            insert into public.user_board_inventory
              (profile_id, board_theme_id, source, granted_by)
            values (caller_id, reward.item_id, 'mission_reward', caller_id)
            on conflict (profile_id, board_theme_id) do nothing;
          else
            insert into public.user_inventory
              (profile_id, item_table, item_id, source, source_ref_id)
            values (caller_id, reward.item_table, reward.item_id,
                    'mission_reward', pdm.mission_template_id::text)
            on conflict (profile_id, item_table, item_id) do nothing;
          end if;
        end if;
      end loop;
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins,
        gems  = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;

    if total_coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'coins', total_coins, wallet_row.coins, 'mission_reward',
              'Mission: ' || mt.title,
              jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
              caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'gems', total_gems, wallet_row.gems, 'mission_reward',
              'Mission: ' || mt.title,
              jsonb_build_object('mission_id', p_mission_id, 'template_id', pdm.mission_template_id),
              caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  if total_xp > 0 then
    update public.profiles
    set xp = xp + total_xp
    where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  mp_award := mt.mission_points;
  if mp_award > 0 then
    insert into public.player_weekly_pass (profile_id, week_key, mp_earned)
    values (caller_id, v_week_key, mp_award)
    on conflict (profile_id, week_key) do update set mp_earned  = public.player_weekly_pass.mp_earned + excluded.mp_earned,
                                                     updated_at = now();
  end if;

  update public.player_daily_missions set claimed_at = now() where id = p_mission_id;

  select count(*)
  into unclaimed_today
  from public.player_daily_missions
  where profile_id = caller_id
    and period = 'daily'
    and expires_at > now()
    and claimed_at is null;

  if unclaimed_today = 0 then
    select current_streak_days, last_complete_date
    into prior_streak, prior_last_date
    from public.player_streak
    where profile_id = caller_id;

    if prior_last_date = current_date then
      new_streak := coalesce(prior_streak, 1);
    elsif prior_last_date = current_date - 1 then
      new_streak := coalesce(prior_streak, 0) + 1;
    else
      new_streak := 1;
    end if;

    insert into public.player_streak
      (profile_id, current_streak_days, last_complete_date)
    values (caller_id, new_streak, current_date)
    on conflict (profile_id) do update set current_streak_days = excluded.current_streak_days,
                                           last_complete_date  = excluded.last_complete_date,
                                           updated_at          = now();
  end if;

  perform public.progress_mission(
    caller_id,
    'missions_claimed_per_day',
    1,
    'claim:' || p_mission_id::text
          );

  return jsonb_build_object(
    'mission_id', p_mission_id,
    'credited_coins', total_coins,
    'credited_gems', total_gems,
    'credited_xp', total_xp,
    'mp_awarded', mp_award,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level),
    'streak_days', coalesce(new_streak, prior_streak),
    'slate_complete', unclaimed_today = 0
         );
end;
$$;


ALTER FUNCTION "public"."claim_mission"("p_mission_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_mission"("p_mission_id" "uuid") IS 'Atomic mission claim. Validates ownership+completion+expiry, credits reward bundle, awards MP, bumps streak if slate is complete, fires meta-mission progress.';



CREATE OR REPLACE FUNCTION "public"."claim_streak_chest"() RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id   uuid := auth.uid();
  streak      public.player_streak;
  reward      record;
  wallet_row  public.user_wallets;
  profile_row public.profiles;
  total_coins int  := 0; total_gems int := 0; total_xp int := 0;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into streak from public.player_streak where profile_id = caller_id for update;
  if not found then raise exception 'no_streak'; end if;
  if streak.current_streak_days < 7 then raise exception 'streak_not_ready'; end if;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict do nothing;
  for reward in
    select reward_kind, currency_code, item_table, item_id, amount
    from public.streak_chest_rewards
    order by display_order
    loop
      if reward.reward_kind = 'currency' then
        case reward.currency_code
          when 'coins' then total_coins := total_coins + reward.amount;
          when 'gems' then total_gems := total_gems + reward.amount;
          when 'xp' then total_xp := total_xp + reward.amount;
          else null;
          end case;
      elsif reward.reward_kind = 'item' then
        if reward.item_table = 'board_theme_configs' then
          insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
          values (caller_id, reward.item_id, 'streak_chest_reward', caller_id)
          on conflict (profile_id, board_theme_id) do nothing;
        else
          insert into public.user_inventory (profile_id, item_table, item_id, source, source_ref_id)
          values (caller_id, reward.item_table, reward.item_id, 'streak_chest_reward', null)
          on conflict (profile_id, item_table, item_id) do nothing;
        end if;
      end if;
    end loop;

  if total_coins > 0 or total_gems > 0 then
    update public.user_wallets
    set coins = coins + total_coins,
        gems  = gems + total_gems
    where profile_id = caller_id
    returning * into wallet_row;
    if total_coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'coins', total_coins, wallet_row.coins, 'streak_chest_reward',
              '7-day streak chest', jsonb_build_object('streak_days_at_claim', streak.current_streak_days), caller_id);
    end if;
    if total_gems > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'gems', total_gems, wallet_row.gems, 'streak_chest_reward',
              '7-day streak chest', jsonb_build_object('streak_days_at_claim', streak.current_streak_days), caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;
  if total_xp > 0 then
    update public.profiles set xp = xp + total_xp where id = caller_id returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  update public.player_streak
  set current_streak_days         = greatest(current_streak_days - 7, 0),
      total_streak_chests_claimed = total_streak_chests_claimed + 1,
      updated_at                  = now()
  where profile_id = caller_id;

  return jsonb_build_object(
    'credited_coins', total_coins, 'credited_gems', total_gems, 'credited_xp', total_xp,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level),
    'new_streak_days', greatest(streak.current_streak_days - 7, 0)
         );
end;
$$;


ALTER FUNCTION "public"."claim_streak_chest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_rows"()
  RETURNS TABLE
          (
            "closed_matches"     integer,
            "dropped_queue_rows" integer
          )
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  closed  int;
  dropped int;
begin
  update public.matches
  set finished_at = now()
  where finished_at is null
    and mode = 'online'
    and opponent_id is null
    and (
    (invite_code is not null and invite_expires_at is not null and invite_expires_at < now())
      or (started_at < now() - interval '24 hours')
    );
  get diagnostics closed = row_count;

  delete
  from public.matchmaking_queue
  where matched_match_id is null
    and created_at < now() - interval '30 minutes';
  get diagnostics dropped = row_count;

  delete
  from public.matchmaking_queue
  where matched_match_id is not null
    and matched_match_id not in (select id from public.matches);

  return query select closed, dropped;
end;
$$;


ALTER FUNCTION "public"."cleanup_stale_rows"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_ai_turn"("p_match_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb",
                                                     "p_game_winner" "text" DEFAULT NULL::"text",
                                                     "p_game_win_type" "text" DEFAULT NULL::"text",
                                                     "p_game_points" integer DEFAULT NULL::integer,
                                                     "p_new_white_score" integer DEFAULT NULL::integer,
                                                     "p_new_black_score" integer DEFAULT NULL::integer,
                                                     "p_match_winner" "text" DEFAULT NULL::"text",
                                                     "p_crawford_game_number" integer DEFAULT NULL::integer) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  match_row   public.matches; bot_color text; next_ply int;
  game_ended  boolean := p_game_winner is not null;
  match_ended boolean := p_match_winner is not null;
begin
  select * into match_row from public.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if not coalesce(match_row.is_bot, false) then raise exception 'not_bot_match'; end if;
  if match_row.finished_at is not null then raise exception 'match_already_finished'; end if;
  if match_row.current_game_id is null then raise exception 'no_current_game'; end if;
  bot_color := case when coalesce(match_row.owner_color, 'white') = 'white' then 'black' else 'white' end;
  select coalesce(max(ply), -1) + 1 into next_ply from public.moves where game_id = match_row.current_game_id;
  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (match_row.current_game_id, next_ply, bot_color, p_dice, coalesce(p_sub_moves, '[]'::jsonb), null);
  if game_ended then
    update public.games
    set winner=p_game_winner,
        win_type=p_game_win_type,
        cube_value=match_row.cube_value,
        cube_owner=match_row.cube_owner,
        points_awarded=coalesce(p_game_points, 0),
        dropped_double= false,
        finished_at=now()
    where id = match_row.current_game_id;
  end if;
  update public.matches
  set current_turn=null,
      white_score=coalesce(p_new_white_score, white_score),
      black_score=coalesce(p_new_black_score, black_score),
      crawford_game_number=coalesce(p_crawford_game_number, crawford_game_number),
      winner=case when match_ended then p_match_winner else winner end,
      finished_at=case when match_ended then now() else finished_at end
  where id = p_match_id;
  if match_ended then perform public.grant_match_reward(p_match_id, p_match_winner, false, false); end if;
  return jsonb_build_object('status', 'ok', 'ply', next_ply, 'bot_color', bot_color, 'game_ended', game_ended,
                            'match_ended', match_ended);
end;
$$;


ALTER FUNCTION "public"."commit_ai_turn"("p_match_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_turn_server"("p_match_id" "uuid", "p_caller_id" "uuid", "p_dice" integer[],
                                                         "p_sub_moves" "jsonb",
                                                         "p_game_winner" "text" DEFAULT NULL::"text",
                                                         "p_game_win_type" "text" DEFAULT NULL::"text",
                                                         "p_game_points" integer DEFAULT NULL::integer,
                                                         "p_game_dropped_double" boolean DEFAULT false,
                                                         "p_new_white_score" integer DEFAULT NULL::integer,
                                                         "p_new_black_score" integer DEFAULT NULL::integer,
                                                         "p_match_winner" "text" DEFAULT NULL::"text",
                                                         "p_crawford_game_number" integer DEFAULT NULL::integer,
                                                         "p_elapsed_ms" integer DEFAULT NULL::integer) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  match_row    public.matches;
  ct           jsonb;
  ct_player    text;
  caller_color text;
  next_ply     int;
  game_ended   boolean := p_game_winner is not null;
  match_ended  boolean := p_match_winner is not null;
begin
  if p_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into match_row from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  if p_caller_id <> match_row.owner_id
    and (match_row.opponent_id is null or p_caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;

  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  ct := match_row.current_turn;
  if ct is null then
    raise exception 'no_turn_in_progress';
  end if;

  ct_player := ct ->> 'player';
  if ct_player not in ('white', 'black') then
    raise exception 'malformed_current_turn';
  end if;

  if p_caller_id = match_row.owner_id then
    caller_color := case
                      when coalesce(match_row.owner_color, 'white') = 'black' then 'black'
                      else 'white'
      end;
  else
    caller_color := case
                      when coalesce(match_row.owner_color, 'white') = 'white' then 'black'
                      else 'white'
      end;
  end if;

  if caller_color <> ct_player then
    raise exception 'not_your_turn';
  end if;

  if match_row.current_game_id is null then
    raise exception 'no_current_game';
  end if;

  select coalesce(max(ply), -1) + 1
  into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (match_row.current_game_id,
          next_ply,
          ct_player,
          p_dice,
          coalesce(p_sub_moves, '[]'::jsonb),
          p_elapsed_ms);

  if game_ended then
    update public.games
    set winner         = p_game_winner,
        win_type       = p_game_win_type,
        cube_value     = match_row.cube_value,
        cube_owner     = match_row.cube_owner,
        points_awarded = coalesce(p_game_points, 0),
        dropped_double = p_game_dropped_double,
        finished_at    = now()
    where id = match_row.current_game_id;
  end if;

  update public.matches
  set current_turn         = null,
      white_score          = coalesce(p_new_white_score, white_score),
      black_score          = coalesce(p_new_black_score, black_score),
      crawford_game_number = coalesce(p_crawford_game_number, crawford_game_number),
      winner               = case when match_ended then p_match_winner else winner end,
      finished_at          = case when match_ended then now() else finished_at end
  where id = p_match_id;

  if match_ended then
    perform public.grant_match_reward(p_match_id, p_match_winner, false, false);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'ply', next_ply,
    'game_ended', game_ended,
    'match_ended', match_ended
         );
end;
$$;


ALTER FUNCTION "public"."commit_turn_server"("p_match_id" "uuid", "p_caller_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_turn_server"("p_match_id" "uuid", "p_caller_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) IS 'Phase 2b: atomic-write half of the server-authoritative turn commit. Called ONLY by the finish_turn edge function (service role) after it replays + validates the turn and derives the true outcome. Mirrors finish_turn''s atomic 3-write but takes p_caller_id and inserts the exact validated p_dice/p_sub_moves. service_role only.';



CREATE OR REPLACE FUNCTION "public"."current_store_sale"()
  RETURNS TABLE
          (
            "label"         "text",
            "bonus_percent" integer,
            "ends_at"       timestamp with time zone
          )
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select label, bonus_percent, ends_at
from public.store_sales
where is_active
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
order by updated_at desc
limit 1;
$$;


ALTER FUNCTION "public"."current_store_sale"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_store_sale"() IS 'Returns the currently-effective store sale (active + within its optional schedule window), or no rows when none is running. Used by the storefront to show the +X% EXTRA badge and boosted amounts. The actual grant boost is applied server-side in private.apply_shop_grants_and_record.';



CREATE OR REPLACE FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") RETURNS integer
  LANGUAGE "sql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select coalesce(max(multiplier), 1)::int
from public.user_xp_boosts
where profile_id = target_profile_id
  and expires_at > now();
$$;


ALTER FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") IS 'Returns the highest active XP multiplier for the given profile, or 1 if no boost is active. Used by XP-granting RPCs to scale rewards.';



CREATE OR REPLACE FUNCTION "public"."daily_streak_rollover"() RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  reset_count int;
begin
  with reset as (
    update public.player_streak
      set current_streak_days = 0, updated_at = now()
      where current_streak_days > 0
        and (last_complete_date is null or last_complete_date < current_date - 1)
      returning 1)
  select count(*)
  into reset_count
  from reset;
  return reset_count;
end;
$$;


ALTER FUNCTION "public"."daily_streak_rollover"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."daily_streak_rollover"() IS 'Zeros current_streak_days for players whose last_complete_date is older than yesterday.';



CREATE OR REPLACE FUNCTION "public"."delete_my_account"() RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'auth', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  update public.matches set opponent_id = null where opponent_id = caller_id;
  delete from auth.users where id = caller_id;
end;
$$;


ALTER FUNCTION "public"."delete_my_account"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_my_account"() IS 'Self-service account deletion: the signed-in caller permanently deletes their own account and all associated data. SECURITY DEFINER, scoped to auth.uid(); no admin gate. Nulls the caller''s matches.opponent_id references then deletes auth.users (cascades to profiles + all player_*/user_* tables). Irreversible. Raises: not_authenticated.';



CREATE OR REPLACE FUNCTION "public"."enforce_personalized_mission_fields"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  v_mode text;
begin
  select resolution_mode into v_mode from public.mission_templates where id = NEW.mission_template_id;
  if v_mode is distinct from 'personalized' then
    NEW.focus_tier := null;
    NEW.reward_coins := null;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."enforce_personalized_mission_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enter_room"("p_table_config_id" "text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  perform p_table_config_id;
  raise exception 'stale_client_reload';
end;
$$;


ALTER FUNCTION "public"."enter_room"("p_table_config_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enter_room"("p_table_config_id" "text") IS 'Stale-client back-compat. Raises stale_client_reload so the client surfaces a "please refresh" toast. Replaces the 20260611 shim that silently routed to enter_room_ai_fallback (which locked stale tabs out of PvP matchmaking).';



CREATE OR REPLACE FUNCTION "public"."enter_room"("p_table_config_id" "text",
                                                 "p_match_mode" "text" DEFAULT 'ai-medium'::"text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid(); caller_level int; cfg public.table_configs; wallet_row public.user_wallets; new_match_id uuid;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  if p_match_mode not in ('hotseat', 'ai-easy', 'ai-medium', 'ai-hard') then
    raise exception 'unsupported_match_mode';
  end if;
  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then raise exception 'room_not_found'; end if;
  if not cfg.is_enabled then raise exception 'room_disabled'; end if;
  if p_match_mode like 'ai-%' and not cfg.allow_ai then raise exception 'ai_not_allowed'; end if;
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level, 1) < cfg.required_level then raise exception 'level_too_low'; end if;
  end if;
  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  if cfg.entry_fee_coins > 0 then
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = caller_id
      and coins >= cfg.entry_fee_coins
    returning * into wallet_row;
    if wallet_row.profile_id is null then raise exception 'insufficient_coins'; end if;
    insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                            created_by)
    values (caller_id, 'coins', -cfg.entry_fee_coins, wallet_row.coins, 'entry_fee', 'Entry fee: ' || cfg.display_name,
            jsonb_build_object('table_config_id', p_table_config_id, 'mode', p_match_mode), caller_id);
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;
  insert into public.matches (owner_id, mode, target, table_config_id, entry_fee_paid_at)
  values (caller_id, p_match_mode, cfg.match_target, p_table_config_id, now())
  returning id into new_match_id;
  return jsonb_build_object('match_id', new_match_id, 'turn_seconds', cfg.turn_seconds, 'mode', p_match_mode, 'target',
                            cfg.match_target, 'wallet',
                            jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems));
end;
$$;


ALTER FUNCTION "public"."enter_room"("p_table_config_id" "text", "p_match_mode" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enter_room"("p_table_config_id" "text", "p_match_mode" "text") IS 'Atomically enters a difficulty room. Validates table_configs row + mode, checks profile level against required_level, debits entry_fee_coins, creates the matches row tagged with table_config_id. Returns jsonb {match_id, turn_seconds, mode, target, wallet}. Raises: not_authenticated, unsupported_match_mode, room_not_found, room_disabled, ai_not_allowed, level_too_low, insufficient_coins.';



CREATE OR REPLACE FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id          uuid := auth.uid();
  cfg                public.table_configs;
  caller_pvp_rating  int;
  wallet_row         public.user_wallets;
  new_match_id       uuid;
  streak_len         int  := 0;
  rec                record;
  implied_ai_level   text;
  effective_ai_level text;
  effective_mode     text;
  effective_is_bot   boolean;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then raise exception 'room_not_found'; end if;
  if not cfg.is_enabled then raise exception 'room_disabled'; end if;
  if not cfg.allow_ai then raise exception 'ai_not_allowed'; end if;

  select pvp_rating into caller_pvp_rating from public.profiles where id = caller_id;
  caller_pvp_rating := coalesce(caller_pvp_rating, 1500);

  delete from public.matchmaking_queue where profile_id = caller_id and matched_match_id is null;

  for rec in
    select winner = owner_color as won
    from public.matches
    where owner_id = caller_id
      and table_config_id = p_table_config_id
      and finished_at is not null
    order by finished_at desc
    limit 10
    loop
      if rec.won then streak_len := streak_len + 1; else exit; end if;
    end loop;

  implied_ai_level := case
                        when caller_pvp_rating < 1300 then 'easy'
                        when caller_pvp_rating < 1700 then 'medium'
                        else 'hard'
    end;
  effective_ai_level := case
                          when cfg.ai_level = 'hard' then 'hard'
                          when cfg.ai_level = 'medium' and implied_ai_level = 'easy' then 'medium'
                          else implied_ai_level
    end;
  if streak_len >= 3 then
    effective_ai_level := case effective_ai_level when 'easy' then 'medium' when 'medium' then 'hard' else 'hard' end;
  end if;

  effective_is_bot := coalesce(cfg.server_bot, false);
  effective_mode := case when effective_is_bot then 'online' else 'ai-' || effective_ai_level end;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;

  if cfg.entry_fee_coins > 0 then
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = caller_id
      and coins >= cfg.entry_fee_coins
    returning * into wallet_row;
    if wallet_row.profile_id is null then raise exception 'insufficient_coins'; end if;
    insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                            created_by)
    values (caller_id, 'coins', -cfg.entry_fee_coins, wallet_row.coins, 'entry_fee',
            'AI fallback entry fee: ' || cfg.display_name,
            jsonb_build_object('table_config_id', p_table_config_id, 'mode', effective_mode, 'is_bot', effective_is_bot,
                               'bot_level', effective_ai_level, 'streak_len', streak_len, 'implied_ai_level',
                               implied_ai_level, 'fallback', true),
            caller_id);
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  insert into public.matches
  (owner_id, mode, target, table_config_id, owner_color, is_bot, bot_level, entry_fee_paid_at)
  values (caller_id, effective_mode, cfg.match_target, p_table_config_id,
          (case when effective_is_bot and random() < 0.5 then 'black' else 'white' end),
          effective_is_bot,
          case when effective_is_bot then effective_ai_level else null end,
          now())
  returning id into new_match_id;

  return jsonb_build_object(
    'match_id', new_match_id, 'turn_seconds', cfg.turn_seconds, 'mode', effective_mode,
    'target', cfg.match_target, 'ai_level', effective_ai_level, 'is_bot', effective_is_bot,
    'bot_level', case when effective_is_bot then effective_ai_level else null end,
    'streak_len', streak_len, 'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems));
end;
$$;


ALTER FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") IS 'AI fallback path for the PvP-first flow. Picks AI level from caller pvp_rating with cfg.ai_level as floor + win-streak escalator, debits entry fee, creates the AI match. When cfg.server_bot: creates an ONLINE bot match (mode=online, is_bot, bot_level, owner=white) played server-authoritatively via ai_move; else legacy mode=ai-<level> (HotSeat). Raises: not_authenticated, room_not_found, room_disabled, ai_not_allowed, insufficient_coins.';



CREATE OR REPLACE FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer DEFAULT 200) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id          uuid := auth.uid();
  caller_level       int;
  cfg                public.table_configs;
  caller_pvp_rating  int;
  partner_id         uuid;
  partner_rating     int;
  new_match_id       uuid;
  rows_updated       int;
  caller_wallet      public.user_wallets;
  partner_wallet     public.user_wallets;
  existing_queue_row public.matchmaking_queue;
  existing_match     public.matches;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.table_configs where id = p_table_config_id;
  if not found then raise exception 'room_not_found'; end if;
  if not cfg.is_enabled then raise exception 'room_disabled'; end if;
  if not cfg.allow_online_pvp then raise exception 'pvp_not_allowed_in_tier'; end if;
  if cfg.required_level > 1 then
    select level into caller_level from public.profiles where id = caller_id;
    if coalesce(caller_level, 1) < cfg.required_level then raise exception 'level_too_low'; end if;
  end if;
  select pvp_rating into caller_pvp_rating from public.profiles where id = caller_id;
  if caller_pvp_rating is null then raise exception 'profile_missing'; end if;
  select * into existing_queue_row from public.matchmaking_queue where profile_id = caller_id;
  if found and existing_queue_row.matched_match_id is not null then
    select * into existing_match from public.matches where id = existing_queue_row.matched_match_id;
    if found and existing_match.finished_at is null then
      return jsonb_build_object('status', 'matched', 'match_id', existing_match.id, 'turn_seconds', cfg.turn_seconds,
                                'target', cfg.match_target);
    end if;
  end if;
  select mq.profile_id, mq.rating
  into partner_id, partner_rating
  from public.matchmaking_queue mq
         join public.profiles p on p.id = mq.profile_id
  where mq.table_config_id = p_table_config_id
    and mq.profile_id <> caller_id
    and mq.matched_match_id is null
    and abs(p.pvp_rating - caller_pvp_rating) <= p_rating_band
  order by mq.created_at asc
  limit 1 for update skip locked;
  if partner_id is null then
    insert into public.matchmaking_queue (profile_id, target, rating, table_config_id, created_at)
    values (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id, now())
    on conflict (profile_id) do update set target=excluded.target,
                                           rating=excluded.rating,
                                           table_config_id=excluded.table_config_id,
                                           created_at=case
                                                        when public.matchmaking_queue.matched_match_id is null
                                                          then now()
                                                        else public.matchmaking_queue.created_at end;
    return jsonb_build_object('status', 'queued');
  end if;
  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  insert into public.user_wallets (profile_id) values (partner_id) on conflict (profile_id) do nothing;
  if cfg.entry_fee_coins > 0 then
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = caller_id
      and coins >= cfg.entry_fee_coins
    returning * into caller_wallet;
    if caller_wallet.profile_id is null then raise exception 'insufficient_coins'; end if;
    update public.user_wallets
    set coins = coins - cfg.entry_fee_coins
    where profile_id = partner_id
      and coins >= cfg.entry_fee_coins
    returning * into partner_wallet;
    if partner_wallet.profile_id is null then
      update public.user_wallets set coins = coins + cfg.entry_fee_coins where profile_id = caller_id;
      raise exception 'partner_insufficient_coins';
    end if;
    insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                            created_by)
    values (caller_id, 'coins', -cfg.entry_fee_coins, caller_wallet.coins, 'entry_fee',
            'PvP entry fee: ' || cfg.display_name,
            jsonb_build_object('table_config_id', p_table_config_id, 'mode', 'online'), caller_id),
           (partner_id, 'coins', -cfg.entry_fee_coins, partner_wallet.coins, 'entry_fee',
            'PvP entry fee: ' || cfg.display_name,
            jsonb_build_object('table_config_id', p_table_config_id, 'mode', 'online'), partner_id);
  end if;
  insert into public.matches (owner_id, opponent_id, mode, target, table_config_id, owner_color, entry_fee_paid_at)
  values (caller_id, partner_id, 'online', cfg.match_target, p_table_config_id,
          (case when random() < 0.5 then 'black' else 'white' end), now())
  returning id into new_match_id;
  update public.matchmaking_queue set matched_match_id = new_match_id where profile_id in (caller_id, partner_id);
  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    insert into public.matchmaking_queue (profile_id, target, rating, table_config_id, matched_match_id, created_at)
    values (caller_id, cfg.match_target, caller_pvp_rating, p_table_config_id, new_match_id, now())
    on conflict (profile_id) do update set matched_match_id=excluded.matched_match_id;
  end if;
  return jsonb_build_object('status', 'matched', 'match_id', new_match_id, 'turn_seconds', cfg.turn_seconds, 'target',
                            cfg.match_target);
end;
$$;


ALTER FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer) IS 'PvP matchmaking inside a difficulty tier. Read-first to recover matched state, then partner-search within rating band, then atomic two-side fee debit + match insert. Returns jsonb with status (queued / matched), optional match_id / turn_seconds / target. Raises: not_authenticated, room_not_found, room_disabled, pvp_not_allowed_in_tier, level_too_low, profile_missing, insufficient_coins, partner_insufficient_coins.';



CREATE OR REPLACE FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer,
                                                   "p_black_score" integer, "p_winner" "text",
                                                   "p_crawford_game_number" integer DEFAULT NULL::integer,
                                                   "p_owner_abandoned" boolean DEFAULT false,
                                                   "p_opponent_abandoned" boolean DEFAULT false) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid();
  match_row public.matches;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_winner is not null and p_winner not in ('white', 'black') then
    raise exception 'invalid_winner';
  end if;

  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if caller_id <> match_row.owner_id and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  update public.matches
  set white_score          = p_white_score,
      black_score          = p_black_score,
      winner               = p_winner,
      crawford_game_number = p_crawford_game_number,
      finished_at          = now()
  where id = p_match_id;

  return public.grant_match_reward(p_match_id, p_winner, p_owner_abandoned, p_opponent_abandoned);
end;
$$;


ALTER FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer, "p_black_score" integer, "p_winner" "text", "p_crawford_game_number" integer, "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer, "p_black_score" integer, "p_winner" "text", "p_crawford_game_number" integer, "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) IS 'Match completion + reward grant. vs-AI path: prize_coins on win, prize_coins_loss on loss, risk-free refund for the first 10 difficulty matches. PvP path: rake = pot * pvp_rake_pct / 100 deducted; loser gets prize_coins_loss (no risk-free); winner gets pot - rake - loser_prize. Both players take ELO movement on a decisive result. Abandoners get zero coins but still take the ELO hit. Idempotent (raises match_already_finished). Returns jsonb with rewards + post-update ratings + PvP rake metadata when applicable.';



CREATE OR REPLACE FUNCTION "public"."finish_turn"("p_match_id" "uuid", "p_game_winner" "text" DEFAULT NULL::"text",
                                                  "p_game_win_type" "text" DEFAULT NULL::"text",
                                                  "p_game_points" integer DEFAULT NULL::integer,
                                                  "p_game_dropped_double" boolean DEFAULT false,
                                                  "p_new_white_score" integer DEFAULT NULL::integer,
                                                  "p_new_black_score" integer DEFAULT NULL::integer,
                                                  "p_match_winner" "text" DEFAULT NULL::"text",
                                                  "p_crawford_game_number" integer DEFAULT NULL::integer,
                                                  "p_elapsed_ms" integer DEFAULT NULL::integer) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id    uuid    := auth.uid();
  match_row    public.matches;
  ct           jsonb;
  ct_player    text;
  caller_color text;
  next_ply     int;
  game_ended   boolean := p_game_winner is not null;
  match_ended  boolean := p_match_winner is not null;
  dice_a       int;
  dice_b       int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into match_row from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  if caller_id <> match_row.owner_id
    and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;

  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;

  ct := match_row.current_turn;
  if ct is null then
    raise exception 'no_turn_in_progress';
  end if;

  ct_player := ct ->> 'player';
  if ct_player not in ('white', 'black') then
    raise exception 'malformed_current_turn';
  end if;

  if caller_id = match_row.owner_id then
    caller_color := case
                      when coalesce(match_row.owner_color, 'white') = 'black' then 'black'
                      else 'white'
      end;
  else
    caller_color := case
                      when coalesce(match_row.owner_color, 'white') = 'white' then 'black'
                      else 'white'
      end;
  end if;

  if caller_color <> ct_player then
    raise exception 'not_your_turn';
  end if;

  if match_row.current_game_id is null then
    raise exception 'no_current_game';
  end if;

  dice_a := (ct -> 'dice' ->> 0)::int;
  dice_b := (ct -> 'dice' ->> 1)::int;

  select coalesce(max(ply), -1) + 1
  into next_ply
  from public.moves
  where game_id = match_row.current_game_id;

  insert into public.moves (game_id, ply, player, dice, sub_moves, elapsed_ms)
  values (match_row.current_game_id,
          next_ply,
          ct_player,
          array [dice_a, dice_b],
          coalesce(ct -> 'subMoves', '[]'::jsonb),
          p_elapsed_ms);

  if game_ended then
    update public.games
    set winner         = p_game_winner,
        win_type       = p_game_win_type,
        cube_value     = match_row.cube_value,
        cube_owner     = match_row.cube_owner,
        points_awarded = coalesce(p_game_points, 0),
        dropped_double = p_game_dropped_double,
        finished_at    = now()
    where id = match_row.current_game_id;
  end if;

  update public.matches
  set current_turn         = null,
      white_score          = coalesce(p_new_white_score, white_score),
      black_score          = coalesce(p_new_black_score, black_score),
      crawford_game_number = coalesce(p_crawford_game_number, crawford_game_number),
      winner               = case when match_ended then p_match_winner else winner end,
      finished_at          = case when match_ended then now() else finished_at end
  where id = p_match_id;

  return jsonb_build_object(
    'status', 'ok',
    'ply', next_ply,
    'game_ended', game_ended,
    'match_ended', match_ended
         );
end;
$$;


ALTER FUNCTION "public"."finish_turn"("p_match_id" "uuid", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finish_turn"("p_match_id" "uuid", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) IS 'Atomic end-of-turn: INSERT moves row + optional UPDATE games (game ended) + UPDATE matches.current_turn=null (with score/crawford/match-end fields). Single transaction, single row lock on matches. Caller must be a match participant and the active player. Raises: not_authenticated, match_not_found, not_match_participant, match_already_finished, no_turn_in_progress, malformed_current_turn, not_your_turn, no_current_game. Returns jsonb {status, ply, game_ended, match_ended}.';



CREATE OR REPLACE FUNCTION "public"."fulfill_google_purchase"("p_profile_id" "uuid", "p_item_id" "text", "p_purchase_token" "text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  item_row         public.shop_items;
  wallet_row       public.user_wallets;
  existing_profile uuid;
begin
  if p_profile_id is null or p_item_id is null or coalesce(p_purchase_token, '') = '' then
    raise exception 'missing_args';
  end if;

  select * into item_row from public.shop_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;

  select profile_id
  into existing_profile
  from public.purchases
  where provider = 'google'
    and provider_transaction_id = p_purchase_token
  limit 1;
  if found then
    select * into wallet_row from public.user_wallets where profile_id = existing_profile;
    return jsonb_build_object(
      'status', 'already_fulfilled',
      'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
           );
  end if;

  begin
    wallet_row := private.apply_shop_grants_and_record(p_profile_id, item_row, 'google', p_purchase_token);
  exception
    when unique_violation then
      select * into wallet_row from public.user_wallets where profile_id = p_profile_id;
      return jsonb_build_object(
        'status', 'already_fulfilled',
        'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
             );
  end;

  return jsonb_build_object(
    'status', 'granted',
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems)
         );
end;
$$;


ALTER FUNCTION "public"."fulfill_google_purchase"("p_profile_id" "uuid", "p_item_id" "text", "p_purchase_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fulfill_google_purchase"("p_profile_id" "uuid", "p_item_id" "text", "p_purchase_token" "text") IS 'service_role-only. Turns a Google-verified purchase token into a grant via private.apply_shop_grants_and_record (provider=google). Idempotent on the token (one grant per token). The validating edge function calls this AFTER Google confirms the token; players cannot call it.';



CREATE OR REPLACE FUNCTION "public"."get_my_admin_role"() RETURNS "text"
  LANGUAGE "sql"
  STABLE
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select private.current_admin_role();
$$;


ALTER FUNCTION "public"."get_my_admin_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_player_lobby_stats"() RETURNS "jsonb"
  LANGUAGE "plpgsql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  me             uuid := auth.uid();
  highest_win    int  := 0;
  streak_days    int  := 0;
  wins           int  := 0;
  total_finished int  := 0;
  win_rate       int  := 0;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(max(amount), 0)
  into highest_win
  from public.wallet_transactions
  where profile_id = me
    and currency = 'coins'
    and source = 'match_reward'
    and amount > 0;

  select coalesce(current_streak_days, 0)
  into streak_days
  from public.player_streak
  where profile_id = me;
  streak_days := coalesce(streak_days, 0);

  select count(*) filter (
    where (owner_id = me and winner = owner_color)
      or (opponent_id = me and winner is not null and winner <> owner_color)
    ),
         count(*)
  into wins, total_finished
  from public.matches
  where finished_at is not null
    and (owner_id = me or opponent_id = me);

  if total_finished > 0 then
    win_rate := round((wins::numeric / total_finished) * 100)::int;
  end if;

  return jsonb_build_object(
    'highest_win', highest_win,
    'streak_days', streak_days,
    'wins', wins,
    'total_finished', total_finished,
    'win_rate_pct', win_rate
         );
end;
$$;


ALTER FUNCTION "public"."get_player_lobby_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_player_lobby_stats"() IS 'Returns the three stats shown on the new lobby profile card: highest single match-reward payout, current daily-missions streak days, and overall win rate (AI + PvP combined). One round-trip; auth.uid() scopes the result to the calling player.';



CREATE OR REPLACE FUNCTION "public"."get_player_missions_today"() RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id     uuid := auth.uid();
  v_week_key    text := to_char(now(), 'IYYY-"W"IW');
  rerolls_today int;
  cfg           public.reroll_pricing_config;
  result        jsonb;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.reroll_pricing_config where id = 'default';
  select count(*)
  into rerolls_today
  from public.mission_rerolls
  where profile_id = caller_id
    and rerolled_at::date = current_date;

  result := jsonb_build_object(
    'missions', (select coalesce(jsonb_agg(
                                   jsonb_build_object(
                                     'id', pdm.id,
                                     'template_id', mt.id,
                                     'rarity', pdm.rarity_slot,
                                     'period', pdm.period,
                                     'title', public.mp_render_mission_text(
                                       mt.title, pdm.resolved_goal,
                                       initcap(replace(coalesce(pdm.focus_tier, mt.params ->> 'difficulty_id', ''),
                                                       'difficulty-', ''))),
                                     'subtitle', public.mp_render_mission_text(
                                       mt.subtitle, pdm.resolved_goal,
                                       initcap(replace(coalesce(pdm.focus_tier, mt.params ->> 'difficulty_id', ''),
                                                       'difficulty-', ''))),
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
                                                  else (select coalesce(jsonb_agg(jsonb_build_object(
                                                                                    'reward_kind', mr.reward_kind,
                                                                                    'currency_code', mr.currency_code,
                                                                                    'item_table', mr.item_table,
                                                                                    'item_id', mr.item_id,
                                                                                    'amount', mr.amount,
                                                                                    'display_order', mr.display_order
                                                                                  ) order by mr.display_order),
                                                                        '[]'::jsonb)
                                                        from public.mission_rewards mr
                                                        where mr.mission_id = mt.id)
                                       end
                                   ) order by
                                     case pdm.period when 'weekly' then 1 else 0 end,
                                     case pdm.rarity_slot
                                       when 'common' then 1
                                       when 'rare' then 2
                                       when 'epic' then 3
                                       else 4 end,
                                     pdm.assigned_at, pdm.id
                                 ), '[]'::jsonb)
                 from public.player_daily_missions pdm
                        join public.mission_templates mt on mt.id = pdm.mission_template_id
                 where pdm.profile_id = caller_id
                   and pdm.expires_at > now()),
    'weekly_pass', coalesce((select jsonb_build_object('week_key', wp.week_key, 'mp_earned', wp.mp_earned,
                                                       'chests_claimed', wp.chests_claimed, 'streak_bonus_active',
                                                       wp.streak_bonus_active)
                             from public.player_weekly_pass wp
                             where wp.profile_id = caller_id
                               and wp.week_key = v_week_key), jsonb_build_object('week_key', v_week_key, 'mp_earned', 0,
                                                                                 'chests_claimed', '[]'::jsonb,
                                                                                 'streak_bonus_active', false)),
    'chest_milestones', (select coalesce(jsonb_agg(jsonb_build_object(
                                                     'milestone_index', cm.milestone_index, 'threshold_mp',
                                                     cm.threshold_mp,
                                                     'display_name', cm.display_name, 'rarity', cm.rarity,
                                                     'rewards', (select coalesce(jsonb_agg(jsonb_build_object(
                                                                                             'reward_kind',
                                                                                             cr.reward_kind,
                                                                                             'currency_code',
                                                                                             cr.currency_code,
                                                                                             'item_table',
                                                                                             cr.item_table, 'item_id',
                                                                                             cr.item_id,
                                                                                             'amount', cr.amount,
                                                                                             'display_order',
                                                                                             cr.display_order
                                                                                           ) order by cr.display_order),
                                                                                 '[]'::jsonb)
                                                                 from public.chest_rewards cr
                                                                 where cr.milestone_id = cm.id)
                                                   ) order by cm.milestone_index), '[]'::jsonb)
                         from public.chest_milestones cm
                         where cm.enabled = true),
    'streak', coalesce((select jsonb_build_object('current_streak_days', ps.current_streak_days,
                                                  'last_complete_date', ps.last_complete_date,
                                                  'total_streak_chests_claimed', ps.total_streak_chests_claimed)
                        from public.player_streak ps
                        where ps.profile_id = caller_id),
                       jsonb_build_object('current_streak_days', 0, 'last_complete_date', null,
                                          'total_streak_chests_claimed', 0)),
    'streak_chest_rewards', (select coalesce(jsonb_agg(jsonb_build_object(
                                                         'reward_kind', scr.reward_kind, 'currency_code',
                                                         scr.currency_code,
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


ALTER FUNCTION "public"."get_player_missions_today"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_player_missions_today"() IS 'Frontend aggregator: single round-trip returning active missions (with reward bundles), weekly pass state, chest milestones + their bundles, streak state + streak chest bundle, and reroll pricing/usage.';



CREATE OR REPLACE FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text",
                                                         "p_since" timestamp with time zone DEFAULT NULL::timestamp with time zone,
                                                         "p_limit" integer DEFAULT 50)
  RETURNS TABLE
          (
            "out_profile_id"      "uuid",
            "out_display_name"    "text",
            "out_matches_played"  bigint,
            "out_matches_won"     bigint,
            "out_win_rate_pct"    numeric,
            "out_coins_wagered"   bigint,
            "out_coins_paid_out"  bigint,
            "out_coins_house_net" bigint,
            "out_actual_rtp_pct"  numeric
          )
  LANGUAGE "plpgsql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid();
  cap       int  := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.is_admin(caller_id) then
    raise exception 'not_admin';
  end if;

  return query
    with match_stats as (select m.owner_id                                       as pid,
                                count(*)                                         as played,
                                count(*) filter (where m.winner = m.owner_color) as won
                         from public.matches m
                         where m.table_config_id = p_table_config_id
                           and m.finished_at is not null
                           and (p_since is null or m.finished_at >= p_since)
                         group by m.owner_id),
         fee_stats as (select wt.profile_id           as pid,
                              sum(-wt.amount)::bigint as wagered
                       from public.wallet_transactions wt
                       where wt.source = 'entry_fee'
                         and wt.currency = 'coins'
                         and (wt.metadata ->> 'table_config_id') = p_table_config_id
                         and (p_since is null or wt.created_at >= p_since)
                       group by wt.profile_id),
         payout_stats as (select wt.profile_id          as pid,
                                 sum(wt.amount)::bigint as paid
                          from public.wallet_transactions wt
                          where wt.source = 'match_reward'
                            and wt.currency = 'coins'
                            and (wt.metadata ->> 'table_config_id') = p_table_config_id
                            and (p_since is null or wt.created_at >= p_since)
                          group by wt.profile_id),
         joined as (select distinct pid
                    from (select pid
                          from match_stats
                          union all
                          select pid
                          from fee_stats
                          union all
                          select pid
                          from payout_stats) u)
    select j.pid,
           coalesce(p.display_name, '(deleted)'),
           coalesce(ms.played, 0),
           coalesce(ms.won, 0),
           case
             when coalesce(ms.played, 0) > 0
               then round(100.0 * ms.won / ms.played, 1)
             else null
             end,
           coalesce(fs.wagered, 0),
           coalesce(ps.paid, 0),
           coalesce(fs.wagered, 0) - coalesce(ps.paid, 0),
           case
             when coalesce(fs.wagered, 0) > 0
               then round(100.0 * coalesce(ps.paid, 0) / fs.wagered, 1)
             else null
             end
    from joined j
           left join public.profiles p on p.id = j.pid
           left join match_stats ms on ms.pid = j.pid
           left join fee_stats fs on fs.pid = j.pid
           left join payout_stats ps on ps.pid = j.pid
    order by abs(coalesce(fs.wagered, 0) - coalesce(ps.paid, 0)) desc, coalesce(ms.played, 0) desc
    limit cap;
end;
$$;


ALTER FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text", "p_since" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text", "p_since" timestamp with time zone, "p_limit" integer) IS 'Per-player RTP drill-down for one difficulty tier. Admin-only. Same time-window semantics as get_rtp_summary; orders by absolute house net so the biggest movers (winners and losers) surface first. Raises: not_authenticated, not_admin.';



CREATE OR REPLACE FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone DEFAULT NULL::timestamp with time zone)
  RETURNS TABLE
          (
            "out_table_config_id"     "text",
            "out_display_name"        "text",
            "out_target_rtp_pct"      integer,
            "out_matches_played"      bigint,
            "out_matches_won"         bigint,
            "out_actual_win_rate_pct" numeric,
            "out_coins_wagered"       bigint,
            "out_coins_paid_out"      bigint,
            "out_coins_house_net"     bigint,
            "out_actual_rtp_pct"      numeric,
            "out_rtp_delta_pct"       numeric,
            "out_risk_free_count"     bigint
          )
  LANGUAGE "plpgsql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;
  if not private.is_admin(caller_id) then
    raise exception 'not_admin';
  end if;

  return query
    with tier_rows as (select tc.id as tid, tc.display_name as dn, tc.target_rtp_pct as trp
                       from public.table_configs tc
                       where tc.kind = 'difficulty'),
         match_stats as (select m.table_config_id                                as tid,
                                count(*)                                         as played,
                                count(*) filter (where m.winner = m.owner_color) as won
                         from public.matches m
                         where m.table_config_id is not null
                           and m.finished_at is not null
                           and (p_since is null or m.finished_at >= p_since)
                         group by m.table_config_id),
         fee_stats as (select (wt.metadata ->> 'table_config_id') as tid,
                              sum(-wt.amount)::bigint             as wagered
                       from public.wallet_transactions wt
                       where wt.source = 'entry_fee'
                         and wt.currency = 'coins'
                         and (p_since is null or wt.created_at >= p_since)
                       group by (wt.metadata ->> 'table_config_id')),
         payout_stats as (select (wt.metadata ->> 'table_config_id') as tid,
                                 sum(wt.amount)::bigint              as paid,
                                 count(*) filter (
                                   where (wt.metadata ->> 'risk_free')::boolean is true
                                   )                                 as risk_free
                          from public.wallet_transactions wt
                          where wt.source = 'match_reward'
                            and wt.currency = 'coins'
                            and (p_since is null or wt.created_at >= p_since)
                          group by (wt.metadata ->> 'table_config_id'))
    select t.tid,
           t.dn,
           t.trp,
           coalesce(ms.played, 0),
           coalesce(ms.won, 0),
           case
             when coalesce(ms.played, 0) > 0
               then round(100.0 * ms.won / ms.played, 1)
             else null
             end,
           coalesce(fs.wagered, 0),
           coalesce(ps.paid, 0),
           coalesce(fs.wagered, 0) - coalesce(ps.paid, 0),
           case
             when coalesce(fs.wagered, 0) > 0
               then round(100.0 * coalesce(ps.paid, 0) / fs.wagered, 1)
             else null
             end,
           case
             when coalesce(fs.wagered, 0) > 0
               then round(100.0 * coalesce(ps.paid, 0) / fs.wagered, 1) - t.trp
             else null
             end,
           coalesce(ps.risk_free, 0)
    from tier_rows t
           left join match_stats ms on ms.tid = t.tid
           left join fee_stats fs on fs.tid = t.tid
           left join payout_stats ps on ps.tid = t.tid
    order by t.tid;
end;
$$;


ALTER FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone) IS 'Per-difficulty-tier RTP aggregation for the BO dashboard. Admin-only. Reads matches + wallet_transactions joined by table_config_id (stored in wt.metadata). Optional p_since restricts to a time window; null = all time. Returns one row per difficulty tier even when there is no traffic. Raises: not_authenticated, not_admin.';



CREATE OR REPLACE FUNCTION "public"."get_wheel_state"("p_config_id" "text" DEFAULT 'main'::"text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id    uuid := auth.uid();
  cfg          public.wheel_configs;
  spin_row     public.user_wheel_spins;
  slots_json   jsonb;
  next_spin_at timestamptz;
  can_spin_now boolean;
begin
  select * into cfg from public.wheel_configs where id = p_config_id;
  if not found then raise exception 'wheel_not_found'; end if;
  if caller_id is not null then
    select *
    into spin_row
    from public.user_wheel_spins
    where profile_id = caller_id
      and config_id = p_config_id;
  end if;
  next_spin_at := case
                    when spin_row.last_spin_at is null then now()
                    else spin_row.last_spin_at + (cfg.cooldown_seconds || ' seconds')::interval
    end;
  can_spin_now := cfg.is_enabled and next_spin_at <= now();
  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'slot_index', s.slot_index,
                      'chance_basis_points', s.chance_basis_points,
                      'label', s.label,
                      'accent_color', s.accent_color,
                      'is_enabled', s.is_enabled,
                      'primary_reward', jsonb_build_object(
                        'type', s.primary_reward_type,
                        'amount', s.primary_reward_amount,
                        'icon_url', s.primary_reward_icon_url
                                        ),
                      'secondary_reward', case
                                            when s.secondary_reward_type is null then null
                                            else jsonb_build_object(
                                              'type', s.secondary_reward_type,
                                              'amount', s.secondary_reward_amount,
                                              'icon_url', s.secondary_reward_icon_url
                                                 )
                        end
                    ) order by s.slot_index
                  ), '[]'::jsonb)
  into slots_json
  from public.wheel_slots s
  where s.config_id = p_config_id;
  return jsonb_build_object(
    'config_id', cfg.id,
    'display_name', cfg.display_name,
    'cooldown_seconds', cfg.cooldown_seconds,
    'is_enabled', cfg.is_enabled,
    'next_spin_at', next_spin_at,
    'can_spin_now', can_spin_now,
    'last_spin_at', spin_row.last_spin_at,
    'last_slot_index', spin_row.last_slot_index,
    'slots', slots_json
         );
end;
$$;


ALTER FUNCTION "public"."get_wheel_state"("p_config_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_match_reward"("p_match_id" "uuid", "p_winner" "text",
                                                         "p_owner_abandoned" boolean DEFAULT false,
                                                         "p_opponent_abandoned" boolean DEFAULT false) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  match_row                public.matches;
  cfg                      public.table_configs;
  wallet_row               public.user_wallets;
  profile_row              public.profiles;
  is_pvp                   boolean;
  xp_mult                  int;
  xp_awarded               int;
  coins_awarded            int;
  owner_won                boolean;
  prior_difficulty_matches int     := 0;
  risk_free_applied        boolean := false;
  pvp_pot                  int     := 0;
  pvp_rake                 int     := 0;
  pvp_winner_coins         int     := 0;
  pvp_loser_coins          int     := 0;
  owner_rating             int;
  opponent_rating          int;
  owner_expected           float;
  owner_score              float;
  owner_new_rating         int;
  opponent_new_rating      int;
  k_factor constant        int     := 32;
begin
  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

  xp_awarded := 0;
  coins_awarded := 0;
  xp_mult := 1;
  owner_won := (p_winner is not null and p_winner = match_row.owner_color);
  is_pvp := match_row.opponent_id is not null;

  if match_row.table_config_id is not null then
    select * into cfg from public.table_configs where id = match_row.table_config_id;
  end if;

  if cfg.id is not null and is_pvp then
    pvp_pot := 2 * cfg.entry_fee_coins;
    pvp_rake := pvp_pot * cfg.pvp_rake_pct / 100;
    pvp_loser_coins := cfg.prize_coins_loss;
    pvp_winner_coins := pvp_pot - pvp_rake - pvp_loser_coins;
    if pvp_winner_coins < 0 then
      pvp_winner_coins := 0;
    end if;
  end if;

  if cfg.id is not null and match_row.entry_fee_paid_at is not null then
    xp_mult := public.current_xp_multiplier(match_row.owner_id);
    xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * xp_mult;

    if owner_won then
      if is_pvp then
        coins_awarded := pvp_winner_coins;
      else
        coins_awarded := cfg.prize_coins;
      end if;
    elsif p_owner_abandoned then
      coins_awarded := 0;
    else
      if is_pvp then
        coins_awarded := pvp_loser_coins;
      else
        coins_awarded := cfg.prize_coins_loss;
        select count(*)
        into prior_difficulty_matches
        from public.matches
        where owner_id = match_row.owner_id
          and table_config_id is not null
          and finished_at is not null
          and id <> p_match_id;
        if prior_difficulty_matches < 10 then
          if cfg.entry_fee_coins > coins_awarded then
            coins_awarded := cfg.entry_fee_coins;
            risk_free_applied := true;
          end if;
        end if;
      end if;
    end if;

    if xp_awarded > 0 then
      update public.profiles
      set xp = xp + xp_awarded
      where id = match_row.owner_id
      returning * into profile_row;
    else
      select * into profile_row from public.profiles where id = match_row.owner_id;
    end if;

    insert into public.user_wallets (profile_id)
    values (match_row.owner_id)
    on conflict (profile_id) do nothing;

    if coins_awarded > 0 then
      update public.user_wallets
      set coins = coins + coins_awarded
      where profile_id = match_row.owner_id
      returning * into wallet_row;
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (match_row.owner_id, 'coins', coins_awarded, wallet_row.coins, 'match_reward',
              case
                when owner_won then 'Match win: '
                when risk_free_applied then 'Risk-free refund: '
                else 'Match consolation: '
                end || cfg.display_name,
              jsonb_build_object(
                'match_id', p_match_id,
                'table_config_id', cfg.id,
                'owner_won', owner_won,
                'risk_free', risk_free_applied,
                'is_pvp', is_pvp,
                'pvp_pot', case when is_pvp then pvp_pot else null end,
                'pvp_rake', case when is_pvp then pvp_rake else null end,
                'pvp_rake_pct', case when is_pvp then cfg.pvp_rake_pct else null end
              ),
              match_row.owner_id);
    else
      select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    end if;

    if is_pvp then
      declare
        opponent_won      boolean := not owner_won;
        opp_xp_mult       int     := 1;
        opp_xp_awarded    int     := 0;
        opp_coins_awarded int     := 0;
        opp_wallet        public.user_wallets;
      begin
        opp_xp_mult := public.current_xp_multiplier(match_row.opponent_id);
        opp_xp_awarded := (cfg.base_xp_win * (100 + cfg.xp_multiplier_pct) / 100) * opp_xp_mult;

        if opponent_won then
          opp_coins_awarded := pvp_winner_coins;
        elsif p_opponent_abandoned then
          opp_coins_awarded := 0;
        else
          opp_coins_awarded := pvp_loser_coins;
        end if;

        if opp_xp_awarded > 0 then
          update public.profiles
          set xp = xp + opp_xp_awarded
          where id = match_row.opponent_id;
        end if;

        insert into public.user_wallets (profile_id)
        values (match_row.opponent_id)
        on conflict (profile_id) do nothing;

        if opp_coins_awarded > 0 then
          update public.user_wallets
          set coins = coins + opp_coins_awarded
          where profile_id = match_row.opponent_id
          returning * into opp_wallet;
          insert into public.wallet_transactions
          (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
          values (match_row.opponent_id, 'coins', opp_coins_awarded, opp_wallet.coins, 'match_reward',
                  case when opponent_won then 'Match win: ' else 'Match consolation: ' end || cfg.display_name,
                  jsonb_build_object(
                    'match_id', p_match_id,
                    'table_config_id', cfg.id,
                    'owner_won', owner_won,
                    'is_pvp', true,
                    'role', 'opponent',
                    'pvp_pot', pvp_pot,
                    'pvp_rake', pvp_rake,
                    'pvp_rake_pct', cfg.pvp_rake_pct
                  ),
                  match_row.opponent_id);
        end if;
      end;
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = match_row.owner_id;
    select * into profile_row from public.profiles where id = match_row.owner_id;
  end if;

  if is_pvp and p_winner is not null and match_row.entry_fee_paid_at is not null then
    select pvp_rating into owner_rating from public.profiles where id = match_row.owner_id;
    select pvp_rating into opponent_rating from public.profiles where id = match_row.opponent_id;
    owner_rating := coalesce(owner_rating, 1500);
    opponent_rating := coalesce(opponent_rating, 1500);

    owner_expected := 1.0 / (1.0 + power(10.0, (opponent_rating - owner_rating)::float / 400.0));
    owner_score := case when owner_won then 1.0 else 0.0 end;

    owner_new_rating := greatest(0, least(4000,
                                          owner_rating + round(k_factor * (owner_score - owner_expected))::int));
    opponent_new_rating := greatest(0, least(4000,
                                             opponent_rating +
                                             round(k_factor * ((1.0 - owner_score) - (1.0 - owner_expected)))::int));

    update public.profiles set pvp_rating = owner_new_rating where id = match_row.owner_id;
    update public.profiles set pvp_rating = opponent_new_rating where id = match_row.opponent_id;
  end if;

  return jsonb_build_object(
    'match_id', match_row.id,
    'owner_won', owner_won,
    'is_pvp', is_pvp,
    'xp_awarded', xp_awarded,
    'xp_multiplier', xp_mult,
    'coins_awarded', coins_awarded,
    'risk_free_applied', risk_free_applied,
    'pvp_pot', case when is_pvp then pvp_pot else null end,
    'pvp_rake', case when is_pvp then pvp_rake else null end,
    'owner_rating', owner_new_rating,
    'opponent_rating', opponent_new_rating,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
         );
end;
$$;


ALTER FUNCTION "public"."grant_match_reward"("p_match_id" "uuid", "p_winner" "text", "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  names text[] := array [
    'Alex','Riley','Jordan','Casey','Morgan','Quinn','Avery','Emerson',
    'Reese','Sage','River','Rowan','Skyler','Tatum','Drew','Phoenix',
    'Cameron','Hayden','Charlie','Eden','Finley','Frankie','Harper',
    'Hunter','Jamie','Jesse','Kai','Logan','Marlowe','Nico','Parker',
    'Peyton','Remy','Robin','Ryan','Shay','Sky','Sutton','Taylor',
    'Wren','Adrian','Ari','Bailey','Blair','Blake','Brett','Devon',
    'Dylan','Ellis','Evan','Gray','Hollis','Indigo','Jules','Kendall',
    'Kenzie','Kit','Lane','Lennon','Lior','Maren','Mika','Noa',
    'Oakley','Ocean','Onyx','Quincy','Ramsey','Rio','Rory','Sasha',
    'Shiloh','Sloan','Tristan','Val','Vesper','Wells','Winter','Zion'
    ];
begin
  insert into public.profiles (id, display_name, is_guest, avatar_seed)
  values (new.id,
          coalesce(
            new.raw_user_meta_data ->> 'display_name',
            names[1 + floor(random() * array_length(names, 1))::int]
          ),
          coalesce(new.is_anonymous, false),
          substr(md5(new.id::text || clock_timestamp()::text), 1, 12));
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_match_by_invite"("invite" "text") RETURNS "uuid"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  m_id   uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  update public.matches
  set opponent_id = caller
  where invite_code = invite
    and mode = 'online'
    and opponent_id is null
    and owner_id != caller
    and (invite_expires_at is null or invite_expires_at > now())
  returning id into m_id;

  if m_id is null then
    raise exception 'invalid_or_expired_invite';
  end if;

  return m_id;
end;
$$;


ALTER FUNCTION "public"."join_match_by_invite"("invite" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_public_match"("target_match_id" "uuid") RETURNS "uuid"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  m_id   uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  update public.matches
  set opponent_id = caller
  where id = target_match_id
    and mode = 'online'
    and is_public = true
    and opponent_id is null
    and owner_id != caller
    and finished_at is null
  returning id into m_id;

  if m_id is null then
    raise exception 'invalid_or_already_joined';
  end if;

  return m_id;
end;
$$;


ALTER FUNCTION "public"."join_public_match"("target_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_tutorial_complete"() RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
  set tutorial_completed_at = now()
  where id = auth.uid()
    and tutorial_completed_at is null;
end;
$$;


ALTER FUNCTION "public"."mark_tutorial_complete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."matches_progress_missions"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  owner_won     boolean;
  opp_won       boolean;
  ctx           jsonb;
  difficulty_id text;
begin
  if OLD.finished_at is not null or NEW.finished_at is null then
    return NEW;
  end if;

  owner_won := NEW.winner is not null and NEW.winner = NEW.owner_color;
  opp_won := NEW.winner is not null and NEW.winner <> NEW.owner_color;

  difficulty_id := case
                     when NEW.table_config_id like 'difficulty-%' then replace(NEW.table_config_id, 'difficulty-', '')
                     when NEW.mode = 'ai-easy' then 'beginner'
                     when NEW.mode = 'ai-medium' then 'advanced'
                     when NEW.mode = 'ai-hard' then 'pro'
                     else NEW.mode
    end;

  ctx := jsonb_build_object('mode', NEW.mode, 'difficulty_id', difficulty_id, 'table_config_id', NEW.table_config_id);

  if NEW.owner_id is not null then
    perform public.progress_mission(
      NEW.owner_id, 'matches_per_day', 1,
      'match:' || NEW.id::text || ':owner', ctx);

    if owner_won then
      perform public.progress_mission(
        NEW.owner_id, 'win_streak', 1,
        'match:' || NEW.id::text || ':owner:win');
    elsif opp_won then
      perform public.progress_mission_reset(NEW.owner_id, 'win_streak');
    end if;
  end if;

  if NEW.opponent_id is not null then
    perform public.progress_mission(
      NEW.opponent_id, 'matches_per_day', 1,
      'match:' || NEW.id::text || ':opp', ctx);

    if opp_won then
      perform public.progress_mission(
        NEW.opponent_id, 'win_streak', 1,
        'match:' || NEW.id::text || ':opp:win');
    elsif owner_won then
      perform public.progress_mission_reset(NEW.opponent_id, 'win_streak');
    end if;
  end if;

  if NEW.mode = 'online' then
    if owner_won and NEW.owner_id is not null then
      perform public.progress_mission(
        NEW.owner_id, 'ranked_wins_per_week', 1,
        'match:' || NEW.id::text || ':rwin:owner');
    elsif opp_won and NEW.opponent_id is not null then
      perform public.progress_mission(
        NEW.opponent_id, 'ranked_wins_per_week', 1,
        'match:' || NEW.id::text || ':rwin:opp');
    end if;
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."matches_progress_missions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."matchmake"("p_target" integer) RETURNS "uuid"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  caller        uuid := auth.uid();
  caller_rating int;
  partner_id    uuid;
  new_match_id  uuid;
  rows_updated  int;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  if p_target < 1 then raise exception 'invalid target'; end if;

  select rating into caller_rating from public.profiles where id = caller;
  if caller_rating is null then return null; end if;

  insert into public.matchmaking_queue (profile_id, target, rating)
  values (caller, p_target, caller_rating)
  on conflict (profile_id) do update
    set target           = excluded.target,
        rating           = excluded.rating,
        created_at       = now(),
        matched_match_id = null;

  select profile_id
  into partner_id
  from public.matchmaking_queue
  where profile_id != caller
    and target = p_target
    and matched_match_id is null
  order by abs(rating - caller_rating), created_at
  limit 1;

  if partner_id is null then
    return null;
  end if;

  insert into public.matches (owner_id, opponent_id, mode, target, owner_color, is_public)
  values (caller, partner_id, 'online', p_target, 'white', false)
  returning id into new_match_id;

  update public.matchmaking_queue
  set matched_match_id = new_match_id
  where profile_id in (caller, partner_id)
    and matched_match_id is null;

  get diagnostics rows_updated = row_count;
  if rows_updated < 2 then
    delete from public.matches where id = new_match_id;
    update public.matchmaking_queue
    set matched_match_id = null
    where profile_id = caller
      and matched_match_id = new_match_id;
    return null;
  end if;

  return new_match_id;
end;
$$;


ALTER FUNCTION "public"."matchmake"("p_target" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_daily_missions"
(
  "id"                  "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"          "uuid"                                               NOT NULL,
  "mission_template_id" "uuid"                                               NOT NULL,
  "rarity_slot"         "text"                                               NOT NULL,
  "resolved_goal"       integer                                              NOT NULL,
  "progress"            integer                  DEFAULT 0                   NOT NULL,
  "completed_at"        timestamp with time zone,
  "claimed_at"          timestamp with time zone,
  "expires_at"          timestamp with time zone                             NOT NULL,
  "assigned_at"         timestamp with time zone DEFAULT "now"()             NOT NULL,
  "reroll_count_today"  integer                  DEFAULT 0                   NOT NULL,
  "period"              "text"                   DEFAULT 'daily'::"text"     NOT NULL,
  "focus_tier"          "text",
  "reward_coins"        integer,
  CONSTRAINT "player_daily_missions_check" CHECK ((("claimed_at" IS NULL) OR ("completed_at" IS NOT NULL))),
  CONSTRAINT "player_daily_missions_period_check" CHECK (("period" = ANY (ARRAY ['daily'::"text", 'weekly'::"text"]))),
  CONSTRAINT "player_daily_missions_progress_check" CHECK (("progress" >= 0)),
  CONSTRAINT "player_daily_missions_rarity_slot_check" CHECK (("rarity_slot" = ANY
                                                               (ARRAY ['common'::"text", 'rare'::"text", 'epic'::"text"]))),
  CONSTRAINT "player_daily_missions_reroll_count_today_check" CHECK (("reroll_count_today" >= 0)),
  CONSTRAINT "player_daily_missions_resolved_goal_check" CHECK (("resolved_goal" > 0))
);


ALTER TABLE "public"."player_daily_missions"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."player_daily_missions"."focus_tier" IS 'Personalized missions: the table_configs tier this mission counts toward (e.g. difficulty-advanced). NULL for legacy/generic missions.';



COMMENT ON COLUMN "public"."player_daily_missions"."reward_coins" IS 'Personalized missions: coin reward snapshotted at assignment. NULL → fall back to the template reward bundle.';



CREATE OR REPLACE FUNCTION "public"."mp_assign_personalized"("p_profile_id" "uuid", "p_mission_type" "text") RETURNS "public"."player_daily_missions"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  cfg          public.mission_type_config;
  v_focus_tier text; v_repr_tier text; v_fee int; v_rtp int;
  v_baseline   numeric; v_loss_unit numeric; v_reward_is_mp boolean := false;
  v_round      int; v_floor int; v_cap int;
  v_target     int; v_last_completed int; v_misses int; v_has_ctrl boolean;
  v_active     public.player_daily_missions; v_prior public.player_daily_missions;
  v_template   public.mission_templates;
  v_reward     int; v_day_end timestamptz; v_row public.player_daily_missions;
begin
  select * into cfg from public.mission_type_config where mission_type = p_mission_type;
  if cfg.mission_type is null or not cfg.supports_personalized then
    raise exception 'mission type % is not personalized-capable', p_mission_type;
  end if;
  v_round := greatest(1, coalesce(cfg.goal_round_to, 1));

  select pdm.*
  into v_active
  from public.player_daily_missions pdm
         join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = p_mission_type
    and mt.resolution_mode = 'personalized'
    and pdm.completed_at is null
    and pdm.expires_at > now()
  order by pdm.assigned_at desc
  limit 1;
  if v_active.id is not null then return v_active; end if;

  select coalesce(table_config_id, mode)
  into v_repr_tier
  from public.matches
  where owner_id = p_profile_id
    and finished_at is not null
    and finished_at >= now() - (cfg.baseline_window_days || ' days')::interval
    and coalesce(table_config_id, '') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc
  limit 1;
  v_repr_tier := coalesce(v_repr_tier, 'difficulty-beginner');
  select entry_fee_coins, target_rtp_pct into v_fee, v_rtp from public.table_configs where id = v_repr_tier;
  v_fee := coalesce(v_fee, 1000); v_rtp := coalesce(v_rtp, 90);

  if p_mission_type = 'play_matches' then
    v_focus_tier := v_repr_tier;
    v_loss_unit := v_fee * (1 - v_rtp / 100.0);
    select coalesce(percentile_cont(0.5) within group (order by c), 0)
    into v_baseline
    from (select count(*)::numeric c
          from public.matches
          where owner_id = p_profile_id
            and finished_at is not null
            and finished_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (finished_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'wager_coins' then
    v_focus_tier := null;
    v_loss_unit := (1 - v_rtp / 100.0);
    select coalesce(percentile_cont(0.5) within group (order by s), 0)
    into v_baseline
    from (select sum(abs(amount))::numeric s
          from public.wallet_transactions
          where profile_id = p_profile_id
            and source = 'entry_fee'
            and currency = 'coins'
            and created_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'win_streak' then
    v_focus_tier := null;
    v_loss_unit := v_fee * (1 - v_rtp / 100.0);
    select greatest(2, round(coalesce(avg(run_len), 0))::int)
    into v_baseline
    from (select count(*)::numeric as run_len
          from (select (m.winner is not null and m.winner = m.owner_color)                                                as won,
                       row_number() over (order by m.finished_at)
                         - row_number()
                           over (partition by (m.winner is not null and m.winner = m.owner_color) order by m.finished_at) as grp
                from public.matches m
                where m.owner_id = p_profile_id
                  and m.finished_at is not null
                  and m.finished_at >= now() - (cfg.baseline_window_days || ' days')::interval) s
          where s.won
          group by s.grp) runs;
  elsif p_mission_type = 'spend_gems' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by s), 0)
    into v_baseline
    from (select sum(abs(amount))::numeric s
          from public.wallet_transactions
          where profile_id = p_profile_id
            and currency = 'gems'
            and amount < 0
            and source in ('purchase', 'mission_reroll_fee')
            and created_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'spin_wheel' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by c), 0)
    into v_baseline
    from (select count(*)::numeric c
          from public.wallet_transactions
          where profile_id = p_profile_id
            and source = 'wheel_spin'
            and currency = 'coins'
            and created_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (created_at at time zone 'UTC')::date) d;
  elsif p_mission_type = 'meta_complete_missions' then
    v_focus_tier := null; v_reward_is_mp := true; v_loss_unit := 0;
    select coalesce(percentile_cont(0.5) within group (order by c), 0)
    into v_baseline
    from (select count(*)::numeric c
          from public.player_daily_missions
          where profile_id = p_profile_id
            and claimed_at is not null
            and claimed_at >= now() - (cfg.baseline_window_days || ' days')::interval
          group by (claimed_at at time zone 'UTC')::date) d;
  else
    raise exception 'mp_assign_personalized: no generator for %', p_mission_type;
  end if;

  v_floor := greatest(v_round, (ceil(v_baseline * cfg.floor_mult / v_round) * v_round)::int);
  v_cap := greatest(v_floor, (ceil(v_baseline * cfg.cap_mult / v_round) * v_round)::int);

  select true, target, last_completed_target, consecutive_misses
  into v_has_ctrl, v_target, v_last_completed, v_misses
  from public.player_mission_difficulty
  where profile_id = p_profile_id
    and mission_type = p_mission_type;

  select pdm.*
  into v_prior
  from public.player_daily_missions pdm
         join public.mission_templates mt on mt.id = pdm.mission_template_id
  where pdm.profile_id = p_profile_id
    and mt.mission_type = p_mission_type
    and mt.resolution_mode = 'personalized'
    and (pdm.completed_at is not null or pdm.expires_at <= now())
  order by pdm.assigned_at desc
  limit 1;

  if v_has_ctrl is null then
    v_target := (ceil(v_baseline * cfg.base_stretch / v_round) * v_round)::int;
    v_last_completed := null; v_misses := 0;
  elsif v_prior.id is not null and v_prior.completed_at is not null then
    v_last_completed := v_prior.resolved_goal;
    v_target := v_prior.resolved_goal + cfg.up_step;
    v_misses := 0;
  elsif v_prior.id is not null and v_prior.expires_at <= now() then
    v_misses := coalesce(v_misses, 0) + 1;
    if v_misses >= cfg.ease_after then
      v_target := least(v_prior.resolved_goal - v_round,
                        (floor(coalesce(v_last_completed, v_prior.resolved_goal) * cfg.ease_factor / v_round) *
                         v_round)::int);
      v_misses := 0;
    else
      v_target := v_prior.resolved_goal;
    end if;
  end if;
  v_target := greatest(v_floor, least(v_cap, greatest(v_round, coalesce(v_target, v_round))));

  insert into public.player_mission_difficulty
  (profile_id, mission_type, target, last_completed_target, consecutive_misses, updated_at)
  values (p_profile_id, p_mission_type, v_target, v_last_completed, v_misses, now())
  on conflict (profile_id, mission_type) do update
    set target=excluded.target,
        last_completed_target=excluded.last_completed_target,
        consecutive_misses=excluded.consecutive_misses,
        updated_at=now();

  v_reward := greatest(cfg.floor_reward,
                       (round((cfg.reward_pct * v_target * coalesce(v_loss_unit, 0)) / cfg.round_to) *
                        cfg.round_to)::int);

  select *
  into v_template
  from public.mission_templates
  where mission_type = p_mission_type
    and resolution_mode = 'personalized'
  limit 1;
  if v_template.id is null then raise exception 'no personalized template for %', p_mission_type; end if;

  v_day_end := (date_trunc('day', (now() at time zone 'UTC')) + interval '1 day') at time zone 'UTC';

  insert into public.player_daily_missions
  (profile_id, mission_template_id, rarity_slot, resolved_goal, progress, expires_at, assigned_at, period, focus_tier,
   reward_coins)
  values (p_profile_id, v_template.id, 'common', v_target, 0, v_day_end, now(), 'daily', v_focus_tier,
          case when v_reward_is_mp then null else v_reward end)
  returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."mp_assign_personalized"("p_profile_id" "uuid", "p_mission_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mp_assign_play_matches"("p_profile_id" "uuid") RETURNS "public"."player_daily_missions"
  LANGUAGE "sql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select public.mp_assign_personalized(p_profile_id, 'play_matches');
$$;


ALTER FUNCTION "public"."mp_assign_play_matches"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mission_templates"
(
  "id"              "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "mission_type"    "text"                                               NOT NULL,
  "metric_code"     "text"                                               NOT NULL,
  "rarity"          "text"                                               NOT NULL,
  "resolution_mode" "text"                                               NOT NULL,
  "goal_value"      integer,
  "stretch_factor"  numeric(5, 2),
  "goal_min"        integer                  DEFAULT 1                   NOT NULL,
  "goal_max"        integer                  DEFAULT 999999              NOT NULL,
  "eligibility"     "jsonb"                  DEFAULT '{}'::"jsonb"       NOT NULL,
  "params"          "jsonb"                  DEFAULT '{}'::"jsonb"       NOT NULL,
  "mission_points"  integer                  DEFAULT 0                   NOT NULL,
  "period"          "text"                   DEFAULT 'daily'::"text"     NOT NULL,
  "title"           "text"                                               NOT NULL,
  "subtitle"        "text",
  "icon_url"        "text",
  "enabled"         boolean                  DEFAULT true                NOT NULL,
  "created_at"      timestamp with time zone DEFAULT "now"()             NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT "now"()             NOT NULL,
  "reward_mode"     "text"                   DEFAULT 'manual'::"text"    NOT NULL,
  "cashback_pct"    numeric,
  CONSTRAINT "mission_templates_check" CHECK (("goal_max" >= "goal_min")),
  CONSTRAINT "mission_templates_check1" CHECK ((
    (("resolution_mode" = 'fixed'::"text") AND ("goal_value" IS NOT NULL) AND ("stretch_factor" IS NULL)) OR
    (("resolution_mode" = 'stretch'::"text") AND ("stretch_factor" IS NOT NULL)) OR
    ("resolution_mode" = 'personalized'::"text"))),
  CONSTRAINT "mission_templates_goal_min_check" CHECK (("goal_min" >= 1)),
  CONSTRAINT "mission_templates_goal_value_check" CHECK ((("goal_value" IS NULL) OR ("goal_value" > 0))),
  CONSTRAINT "mission_templates_mission_points_check" CHECK (("mission_points" >= 0)),
  CONSTRAINT "mission_templates_period_check" CHECK (("period" = ANY (ARRAY ['daily'::"text", 'weekly'::"text"]))),
  CONSTRAINT "mission_templates_rarity_check" CHECK (("rarity" = ANY
                                                      (ARRAY ['common'::"text", 'rare'::"text", 'epic'::"text"]))),
  CONSTRAINT "mission_templates_resolution_mode_check" CHECK (("resolution_mode" = ANY
                                                               (ARRAY ['fixed'::"text", 'stretch'::"text", 'personalized'::"text"]))),
  CONSTRAINT "mission_templates_reward_mode_check" CHECK (("reward_mode" = ANY (ARRAY ['manual'::"text", 'cashback'::"text"]))),
  CONSTRAINT "mission_templates_stretch_factor_check" CHECK ((("stretch_factor" IS NULL) OR ("stretch_factor" > (0)::numeric)))
);


ALTER TABLE "public"."mission_templates"
  OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mp_cashback_reward"("t" "public"."mission_templates", "p_goal" integer) RETURNS integer
  LANGUAGE "plpgsql"
  STABLE
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  v_fee        int;
  v_rtp        int;
  v_edge       numeric;
  v_investment numeric;
begin
  if t.reward_mode <> 'cashback' or coalesce(t.cashback_pct, 0) <= 0 or coalesce(p_goal, 0) <= 0 then
    return null;
  end if;

  select tc.entry_fee_coins, tc.target_rtp_pct
  into v_fee, v_rtp
  from public.table_configs tc
  where tc.id = 'difficulty-' || nullif(t.params ->> 'difficulty_id', '');
  v_edge := 1 - coalesce(v_rtp, 90) / 100.0;

  if t.metric_code = 'coins_wagered_per_day' then
    v_investment := p_goal;
  elsif v_fee is not null then
    v_investment := p_goal::numeric * v_fee;
  else
    return null;
  end if;

  return greatest(0, (ceil((t.cashback_pct * v_investment * v_edge) / 100.0) * 100)::int);
end;
$$;


ALTER FUNCTION "public"."mp_cashback_reward"("t" "public"."mission_templates", "p_goal" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mp_play_matches_preview"("p_profile_id" "uuid")
  RETURNS TABLE
          (
            "focus_tier"              "text",
            "focus_label"             "text",
            "window_matches"          integer,
            "window_active_days"      integer,
            "baseline_per_active_day" numeric,
            "resolved_goal"           integer,
            "reward_coins"            integer,
            "tier_fee"                integer,
            "tier_rtp"                integer
          )
  LANGUAGE "plpgsql"
  STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  v_focus        text;
  v_fee          int;
  v_rtp          int;
  v_baseline     numeric;
  v_total        int;
  v_days         int;
  v_target       int;
  v_floor        int;
  v_cap          int;
  c_stretch      numeric := 1.3;
  c_reward_pct   numeric := 0.10;
  c_floor_reward int     := 250;
  c_round        int     := 50;
  c_window       int     := 30;
begin
  select coalesce(table_config_id, mode)
  into v_focus
  from public.matches
  where owner_id = p_profile_id
    and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval
    and coalesce(table_config_id, '') like 'difficulty-%'
  group by coalesce(table_config_id, mode)
  order by count(*) desc, max(finished_at) desc
  limit 1;
  v_focus := coalesce(v_focus, 'difficulty-beginner');

  select entry_fee_coins, target_rtp_pct
  into v_fee, v_rtp
  from public.table_configs
  where id = v_focus;
  v_fee := coalesce(v_fee, 1000);
  v_rtp := coalesce(v_rtp, 90);

  select count(*), count(distinct (finished_at at time zone 'UTC')::date)
  into v_total, v_days
  from public.matches
  where owner_id = p_profile_id
    and finished_at is not null
    and finished_at >= now() - (c_window || ' days')::interval;

  select coalesce(percentile_cont(0.5) within group (order by c), 0)
  into v_baseline
  from (select count(*)::numeric c
        from public.matches
        where owner_id = p_profile_id
          and finished_at is not null
          and finished_at >= now() - (c_window || ' days')::interval
        group by (finished_at at time zone 'UTC')::date) d;

  v_floor := greatest(1, ceil(v_baseline * 0.5)::int);
  v_cap := greatest(v_floor, ceil(v_baseline * 2)::int);
  v_target := greatest(v_floor, least(v_cap, greatest(1, ceil(v_baseline * c_stretch)::int)));

  return query select v_focus,
                      initcap(replace(replace(v_focus, 'difficulty-', ''), '-', ' ')),
                      v_total,
                      v_days,
                      round(v_baseline, 2),
                      v_target,
                      greatest(c_floor_reward,
                               (round((c_reward_pct * v_target * v_fee * (1 - v_rtp / 100.0)) / c_round) *
                                c_round)::int),
                      v_fee,
                      v_rtp;
end;
$$;


ALTER FUNCTION "public"."mp_play_matches_preview"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") RETURNS "text"
  LANGUAGE "sql"
  IMMUTABLE
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select nullif(btrim(regexp_replace(
  replace(
    replace(
      regexp_replace(
        coalesce(p_text, ''),
        '\{goal\|([^|}]*)\|([^}]*)\}',
        case when coalesce(p_goal, 0) = 1 then '\1' else '\2' end,
        'g'),
      '{goal}', coalesce(to_char(p_goal, 'FM999,999,999,999'), '')),
    '{tier}', coalesce(p_tier, '')
  ),
  '\s+', ' ', 'g')), '');
$$;


ALTER FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") IS 'Renders mission title/subtitle tokens: {goal} (number), {tier} (title-cased tier), and {goal|singular|plural} (picks singular when goal=1, else plural). Whitespace-collapsed; null in → null out.';



CREATE OR REPLACE FUNCTION "public"."profiles_auto_promote_level"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  target_lvl   int;
  total_coins  int := 0;
  total_gems   int := 0;
  lvl_row      public.level_configs;
  wallet_after public.user_wallets;
begin
  if new.xp <= coalesce(old.xp, 0) then
    return new;
  end if;

  select level
  into target_lvl
  from public.level_configs
  where is_enabled
    and xp_required <= new.xp
  order by level desc
  limit 1;

  if target_lvl is null or target_lvl <= coalesce(new.level, 1) then
    return new;
  end if;

  for lvl_row in
    select *
    from public.level_configs
    where is_enabled
      and level > coalesce(new.level, 1)
      and level <= target_lvl
    order by level asc
    loop
      total_coins := total_coins + coalesce(lvl_row.reward_coins, 0);
      total_gems := total_gems + coalesce(lvl_row.reward_gems, 0);
    end loop;

  new.level := target_lvl;

  if total_coins > 0 or total_gems > 0 then
    insert into public.user_wallets (profile_id)
    values (new.id)
    on conflict (profile_id) do nothing;

    update public.user_wallets
    set coins = coins + total_coins,
        gems  = gems + total_gems
    where profile_id = new.id
    returning * into wallet_after;

    if total_coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after,
       source, reason, metadata, created_by)
      values (new.id, 'coins', total_coins, coalesce(wallet_after.coins, 0),
              'level_reward',
              'Level-up reward: ' || coalesce(old.level, 1) || ' → ' || target_lvl,
              jsonb_build_object(
                'from_level', coalesce(old.level, 1),
                'to_level', target_lvl,
                'reward_gems', total_gems
              ),
              new.id);
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."profiles_auto_promote_level"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_progress_level_missions"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  delta int;
begin
  delta := coalesce(NEW.level, 0) - coalesce(OLD.level, 0);
  if delta > 0 then
    perform public.progress_mission(NEW.id, 'levels_per_week', delta,
                                    'level:' || NEW.id::text || ':' || NEW.level::text);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."profiles_progress_level_missions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_progress_xp_missions"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  delta int;
begin
  delta := coalesce(NEW.xp, 0) - coalesce(OLD.xp, 0);
  if delta > 0 then
    perform public.progress_mission(NEW.id, 'xp_per_day', delta, 'xp:' || NEW.id::text || ':' || NEW.xp::text);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."profiles_progress_xp_missions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."progress_mission"("p_profile_id" "uuid", "p_metric_code" "text", "p_delta" integer,
                                                       "p_event_id" "text" DEFAULT NULL::"text",
                                                       "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  if p_delta <= 0 then return; end if;

  if p_event_id is not null then
    begin
      insert into public.mission_progress_events
        (event_id, profile_id, metric_code, delta)
      values (p_event_id, p_profile_id, p_metric_code, p_delta);
    exception
      when unique_violation then
        return;
    end;
  end if;

  update public.player_daily_missions pdm
  set progress     = least(pdm.progress + p_delta, pdm.resolved_goal),
      completed_at = case
                       when pdm.progress + p_delta >= pdm.resolved_goal
                         and pdm.completed_at is null
                         then now()
                       else pdm.completed_at
        end
  from public.mission_templates mt
  where mt.id = pdm.mission_template_id
    and pdm.profile_id = p_profile_id
    and mt.metric_code = p_metric_code
    and pdm.expires_at > now()
    and pdm.claimed_at is null
    and (mt.params = '{}'::jsonb or mt.params <@ p_context)
    and (pdm.focus_tier is null or pdm.focus_tier = (p_context ->> 'table_config_id'));
end;
$$;


ALTER FUNCTION "public"."progress_mission"("p_profile_id" "uuid", "p_metric_code" "text", "p_delta" integer, "p_event_id" "text", "p_context" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."progress_mission"("p_profile_id" "uuid", "p_metric_code" "text", "p_delta" integer, "p_event_id" "text", "p_context" "jsonb") IS 'Incremental progress for any active mission whose metric matches, whose template params are contained in the event context, and whose focus_tier (if set) matches the event table_config_id. Idempotent via event_id.';



CREATE OR REPLACE FUNCTION "public"."progress_mission_reset"("p_profile_id" "uuid", "p_metric_code" "text") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  update public.player_daily_missions pdm
  set progress = 0
  from public.mission_templates mt
  where mt.id = pdm.mission_template_id
    and pdm.profile_id = p_profile_id
    and mt.metric_code = p_metric_code
    and pdm.expires_at > now()
    and pdm.completed_at is null
    and pdm.claimed_at is null;
end;
$$;


ALTER FUNCTION "public"."progress_mission_reset"("p_profile_id" "uuid", "p_metric_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."progress_mission_reset"("p_profile_id" "uuid", "p_metric_code" "text") IS 'Zeros progress on un-completed missions for a metric. Used for win_streak resets on match loss.';



CREATE OR REPLACE FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") RETURNS "public"."user_wallets"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id    uuid := auth.uid();
  board_row    public.board_theme_configs;
  player_level int;
  cost_gems    int;
  wallet_row   public.user_wallets;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into board_row from public.board_theme_configs where id = target_board_id;
  if not found then
    raise exception 'board_not_found';
  end if;
  if not board_row.is_enabled then
    raise exception 'board_disabled';
  end if;

  cost_gems := coalesce(board_row.price_gems, 0);
  if cost_gems <= 0 then
    raise exception 'board_not_purchasable';
  end if;

  select level into player_level from public.profiles where id = caller_id;
  if player_level is null then
    raise exception 'profile_not_found';
  end if;
  if player_level < board_row.unlock_level then
    raise exception 'level_too_low';
  end if;

  if exists (select 1
             from public.user_board_inventory
             where profile_id = caller_id
               and board_theme_id = target_board_id) then
    raise exception 'already_owned';
  end if;

  insert into public.user_wallets (profile_id)
  values (caller_id)
  on conflict (profile_id) do nothing;

  update public.user_wallets
  set gems = gems - cost_gems
  where profile_id = caller_id
    and gems >= cost_gems
  returning * into wallet_row;

  if wallet_row.profile_id is null then
    raise exception 'insufficient_gems';
  end if;

  insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                          created_by)
  values (caller_id,
          'gems',
          -cost_gems,
          wallet_row.gems,
          'purchase',
          'Board purchase: ' || target_board_id,
          jsonb_build_object('board_theme_id', target_board_id),
          caller_id);

  insert into public.user_board_inventory (profile_id, board_theme_id, source, granted_by)
  values (caller_id, target_board_id, 'purchase', caller_id);

  return wallet_row;
end;
$$;


ALTER FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") IS 'Atomically purchases a board with gems. Checks unlock_level, debits gems, logs wallet_transactions, inserts user_board_inventory with source=purchase. Returns the updated wallet row. Raises: not_authenticated, board_not_found, board_disabled, board_not_purchasable, profile_not_found, level_too_low, already_owned, insufficient_gems.';



CREATE OR REPLACE FUNCTION "public"."purchase_shop_item"("target_item_id" "text") RETURNS "public"."user_wallets"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid(); item_row public.shop_items; cost_gems int; wallet_row public.user_wallets; reason_label text;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into item_row from public.shop_items where id = target_item_id;
  if not found then raise exception 'item_not_found'; end if;
  cost_gems := coalesce(item_row.price_gems, 0);
  if cost_gems <= 0 then raise exception 'item_not_gem_priced'; end if;
  perform private.assert_shop_item_purchasable(caller_id, item_row);
  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;
  update public.user_wallets
  set gems = gems - cost_gems
  where profile_id = caller_id
    and gems >= cost_gems
  returning * into wallet_row;
  if wallet_row.profile_id is null then raise exception 'insufficient_gems'; end if;
  reason_label := coalesce(item_row.display_name, target_item_id);
  insert into public.wallet_transactions (profile_id, currency, amount, balance_after, source, reason, metadata,
                                          created_by)
  values (caller_id, 'gems', -cost_gems, wallet_row.gems, 'purchase', 'Shop purchase: ' || reason_label,
          jsonb_build_object('shop_item_id', target_item_id), caller_id);
  return private.apply_shop_grants_and_record(caller_id, item_row, 'gems', null);
end;
$$;


ALTER FUNCTION "public"."purchase_shop_item"("target_item_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purchase_shop_item"("target_item_id" "text") IS 'Atomically purchases a gem-priced shop item: enforces enabled/schedule/per-user-cap (private.assert_shop_item_purchasable), debits gems, then applies grants + records the purchase via private.apply_shop_grants_and_record (provider=gems). Raises: not_authenticated, item_not_found, item_not_gem_priced, item_disabled, item_not_yet_available, item_expired, purchase_limit_reached, insufficient_gems, unsupported_grant:<key>, invalid_xp_boost_grant, already_owned_board.';



CREATE OR REPLACE FUNCTION "public"."recompute_daily_mission_metrics"() RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  -- matches_per_day
  with all_match_events as (select owner_id as profile_id, finished_at
                            from public.matches
                            where finished_at is not null
                              and finished_at > now() - interval '7 days'
                              and owner_id is not null
                            union all
                            select opponent_id as profile_id, finished_at
                            from public.matches
                            where finished_at is not null
                              and finished_at > now() - interval '7 days'
                              and opponent_id is not null)
  insert
  into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'matches_per_day',
         (count(*) filter (where finished_at > now() - interval '1 day'))::int,
         (count(*)::numeric / 7.0)
  from all_match_events
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- coins_wagered_per_day
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'coins_wagered_per_day',
         coalesce((sum(abs(amount)) filter (where created_at > now() - interval '1 day'))::int, 0),
         coalesce(sum(abs(amount))::numeric / 7.0, 0)
  from public.wallet_transactions
  where source = 'entry_fee'
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- coins_won_net_per_day
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'coins_won_net_per_day',
         greatest(coalesce((sum(amount) filter (where created_at > now() - interval '1 day'))::int, 0), 0),
         greatest(coalesce(sum(amount)::numeric / 7.0, 0), 0)
  from public.wallet_transactions
  where source in ('match_reward', 'entry_fee')
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- gems_spent_per_day
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'gems_spent_per_day',
         coalesce((sum(abs(amount)) filter (where created_at > now() - interval '1 day'))::int, 0),
         coalesce(sum(abs(amount))::numeric / 7.0, 0)
  from public.wallet_transactions
  where source in ('purchase', 'mission_reroll_fee')
    and currency = 'gems'
    and amount < 0
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- wheel_spins_per_day
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'wheel_spins_per_day',
         (count(*) filter (where created_at > now() - interval '1 day'))::int,
         (count(*)::numeric / 7.0)
  from public.wallet_transactions
  where source = 'wheel_spin'
    and currency = 'coins'
    and created_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- missions_claimed_per_day
  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id,
         'missions_claimed_per_day',
         (count(*) filter (where claimed_at > now() - interval '1 day'))::int,
         (count(*)::numeric / 7.0)
  from public.player_daily_missions
  where claimed_at is not null
    and claimed_at > now() - interval '7 days'
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- ranked_wins_per_week (weekly total, not /7)
  with online_wins as (select owner_id as profile_id
                       from public.matches
                       where mode = 'online'
                         and finished_at is not null
                         and finished_at > now() - interval '7 days'
                         and winner is not null
                         and winner = owner_color
                         and owner_id is not null
                       union all
                       select opponent_id as profile_id
                       from public.matches
                       where mode = 'online'
                         and finished_at is not null
                         and finished_at > now() - interval '7 days'
                         and winner is not null
                         and winner <> owner_color
                         and opponent_id is not null)
  insert
  into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  select profile_id, 'ranked_wins_per_week', 0::int, count(*)::numeric
  from online_wins
  group by profile_id
  on conflict (profile_id, metric_code) do update set value_today = excluded.value_today,
                                                      baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  -- metric_distributions: replace all. metric_code is the PK so it's
  -- always non-null; this WHERE clause satisfies the no-unconditional-
  -- writes safety rule while being functionally identical to no-WHERE.
  delete from public.metric_distributions where metric_code is not null;

  insert into public.metric_distributions (metric_code, percentile, value)
  select pm.metric_code,
         p.percentile,
         coalesce(percentile_cont(p.percentile / 100.0) within group (order by pm.baseline_7d), 0)::numeric(12, 2)
  from public.player_metrics pm
         cross join lateral (values (10), (25), (33), (50), (66), (75), (90), (95)) as p(percentile)
  where pm.baseline_7d > 0
  group by pm.metric_code, p.percentile;

  -- player_metric_tiers
  insert into public.player_metric_tiers (profile_id, metric_code, tier)
  select pm.profile_id,
         pm.metric_code,
         case
           when pm.baseline_7d <= 0 then 'casual'
           when pm.baseline_7d >= coalesce(
             (select value from public.metric_distributions where metric_code = pm.metric_code and percentile = 66),
             99999999) then 'whale'
           when pm.baseline_7d >= coalesce(
             (select value from public.metric_distributions where metric_code = pm.metric_code and percentile = 33), 0)
             then 'regular'
           else 'casual'
           end
  from public.player_metrics pm
  on conflict (profile_id, metric_code) do update set tier       = excluded.tier,
                                                      updated_at = now();
end;
$$;


ALTER FUNCTION "public"."recompute_daily_mission_metrics"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recompute_daily_mission_metrics"() IS 'Nightly recompute of Daily Missions metrics. Rebuilds player_metrics from source tables, metric_distributions (percentiles), and player_metric_tiers (casual/regular/whale). Idempotent.';



CREATE OR REPLACE FUNCTION "public"."recompute_player_levels"() RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  affected integer;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized to recompute player levels';
  end if;

  with target as (select pr.id, max(lc.level) as target_lvl
                  from public.profiles pr
                         join public.level_configs lc
                              on lc.is_enabled and lc.xp_required <= pr.xp
                  group by pr.id)
  update public.profiles p
  set level = t.target_lvl
  from target t
  where p.id = t.id
    and t.target_lvl > p.level;

  get diagnostics affected = row_count;
  return affected;
end;
$$;


ALTER FUNCTION "public"."recompute_player_levels"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recompute_player_levels"() IS 'Promote-only level alignment: bumps each non-deleted profile UP to the highest enabled level its xp qualifies for under the current level_configs curve. Never demotes, never grants rewards. Admin-only. Returns count promoted. Call after a curve change so existing players are not left frozen at a stale level.';



CREATE OR REPLACE FUNCTION "public"."replace_opponent_with_ai"("p_match_id" "uuid", "p_min_inactive_seconds" integer DEFAULT 30) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id          uuid := auth.uid();
  match_row          public.matches;
  caller_pvp_rating  int;
  abandoner_id       uuid;
  inactivity_seconds int;
  implied_ai_level   text;
  effective_mode     text;
  rows_affected      int;
begin
  if caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into match_row from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

  if caller_id <> match_row.owner_id
    and (match_row.opponent_id is null or caller_id <> match_row.opponent_id) then
    raise exception 'not_match_participant';
  end if;
  if match_row.finished_at is not null then
    raise exception 'match_already_finished';
  end if;
  if match_row.mode like 'ai-%' then
    return jsonb_build_object(
      'status', 'already_converted',
      'mode', match_row.mode,
      'ai_level', substr(match_row.mode, 4)
           );
  end if;
  if match_row.mode <> 'online' or match_row.opponent_id is null then
    raise exception 'not_a_pvp_match';
  end if;

  abandoner_id := case
                    when caller_id = match_row.owner_id then match_row.opponent_id
                    else match_row.owner_id
    end;

  inactivity_seconds := extract(epoch from (now() - match_row.updated_at))::int;
  if inactivity_seconds < greatest(p_min_inactive_seconds, 5) then
    raise exception 'opponent_still_active';
  end if;

  select pvp_rating
  into caller_pvp_rating
  from public.profiles
  where id = caller_id;
  caller_pvp_rating := coalesce(caller_pvp_rating, 1500);
  implied_ai_level := case
                        when caller_pvp_rating < 1300 then 'easy'
                        when caller_pvp_rating < 1700 then 'medium'
                        else 'hard'
    end;
  effective_mode := 'ai-' || implied_ai_level;

  update public.matches
  set mode         = effective_mode,
      current_turn = coalesce(current_turn, '{}'::jsonb)
        || jsonb_build_object('_abandonment', jsonb_build_object(
          'abandoner_id', abandoner_id,
          'converted_at', now()
                                              )),
      updated_at   = now()
  where id = p_match_id
    and mode = 'online'
    and finished_at is null;

  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    raise exception 'race_lost';
  end if;

  return jsonb_build_object(
    'status', 'converted',
    'mode', effective_mode,
    'ai_level', implied_ai_level,
    'abandoner_id', abandoner_id,
    'inactivity_seconds', inactivity_seconds
         );
end;
$$;


ALTER FUNCTION "public"."replace_opponent_with_ai"("p_match_id" "uuid", "p_min_inactive_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id       uuid := auth.uid();
  pdm             public.player_daily_missions;
  prior_mt        public.mission_templates;
  new_template    public.mission_templates;
  cfg             public.reroll_pricing_config;
  prof            public.profiles;
  baseline        numeric;
  v_resolved_goal int;
  rerolls_today   int;
  gem_cost        int;
  wallet_row      public.user_wallets;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select *
  into pdm
  from public.player_daily_missions
  where id = p_mission_id
    and profile_id = caller_id for update;
  if not found then raise exception 'mission_not_found'; end if;
  if pdm.expires_at <= now() then raise exception 'mission_expired'; end if;
  if pdm.completed_at is not null then raise exception 'mission_already_complete'; end if;
  if pdm.claimed_at is not null then raise exception 'mission_already_claimed'; end if;

  select * into prior_mt from public.mission_templates where id = pdm.mission_template_id;
  select * into cfg from public.reroll_pricing_config where id = 'default';
  if not found then raise exception 'reroll_config_missing'; end if;

  select count(*)
  into rerolls_today
  from public.mission_rerolls
  where profile_id = caller_id
    and rerolled_at::date = current_date;
  if rerolls_today >= cfg.daily_cap then raise exception 'reroll_cap_reached'; end if;
  if rerolls_today >= array_length(cfg.gem_cost_ladder, 1) then raise exception 'reroll_cap_reached'; end if;
  gem_cost := cfg.gem_cost_ladder[rerolls_today + 1];

  select * into prof from public.profiles where id = caller_id;
  select t.*
  into new_template
  from public.mission_templates t
  where t.enabled = true
    and t.period = pdm.period
    and t.rarity = pdm.rarity_slot
    and (t.eligibility ->> 'min_level' is null or (t.eligibility ->> 'min_level')::int <= prof.level)
    and (t.eligibility ->> 'max_level' is null or (t.eligibility ->> 'max_level')::int >= prof.level)
    and (
    not (t.eligibility ? 'requires_rated' and (t.eligibility ->> 'requires_rated')::boolean)
      or coalesce(prof.pvp_rating, 0) > 0
    )
    and t.id <> pdm.mission_template_id
    and not exists (select 1
                    from public.player_daily_missions pdm2
                    where pdm2.profile_id = caller_id
                      and pdm2.mission_template_id = t.id
                      and pdm2.assigned_at > now() - interval '3 days')
    and t.mission_type <> all (select mt.mission_type
                               from public.player_daily_missions p
                                      join public.mission_templates mt on mt.id = p.mission_template_id
                               where p.profile_id = caller_id
                                 and p.expires_at > now()
                                 and p.id <> pdm.id)
  order by random()
  limit 1;
  if new_template.id is null then raise exception 'no_replacement_available'; end if;

  if gem_cost > 0 then
    insert into public.user_wallets (profile_id) values (caller_id) on conflict do nothing;
    update public.user_wallets
    set gems = gems - gem_cost
    where profile_id = caller_id
      and gems >= gem_cost
    returning * into wallet_row;
    if wallet_row.profile_id is null then raise exception 'insufficient_gems'; end if;
    insert into public.wallet_transactions
    (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
    values (caller_id, 'gems', -gem_cost, wallet_row.gems, 'mission_reroll_fee',
            'Mission reroll',
            jsonb_build_object('prior_template_id', pdm.mission_template_id,
                               'new_template_id', new_template.id,
                               'rerolls_today', rerolls_today + 1), caller_id);
  end if;

  if new_template.resolution_mode = 'fixed' then
    v_resolved_goal := new_template.goal_value;
  else
    select pm.baseline_7d
    into baseline
    from public.player_metrics pm
    where pm.profile_id = caller_id
      and pm.metric_code = new_template.metric_code;
    baseline := coalesce(baseline, 0);
    v_resolved_goal := greatest(new_template.goal_min,
                                least(new_template.goal_max,
                                      greatest(1, ceil(baseline * new_template.stretch_factor)::int)));
  end if;

  update public.player_daily_missions
  set mission_template_id = new_template.id,
      resolved_goal       = v_resolved_goal,
      progress            = 0,
      completed_at        = null,
      assigned_at         = now()
  where id = p_mission_id;

  insert into public.mission_rerolls
  (profile_id, gem_cost, prior_template_id, new_template_id, player_daily_mission_id)
  values (caller_id, gem_cost, pdm.mission_template_id, new_template.id, p_mission_id);

  return jsonb_build_object(
    'mission_id', p_mission_id, 'new_template_id', new_template.id,
    'title', new_template.title, 'subtitle', new_template.subtitle,
    'icon_url', new_template.icon_url, 'rarity', new_template.rarity,
    'resolved_goal', v_resolved_goal, 'gem_cost', gem_cost,
    'rerolls_today', rerolls_today + 1,
    'next_reroll_cost', case
                          when rerolls_today + 1 >= cfg.daily_cap then null
                          when rerolls_today + 1 >= array_length(cfg.gem_cost_ladder, 1) then null
                          else cfg.gem_cost_ladder[rerolls_today + 2] end,
    'wallet_gems', coalesce(wallet_row.gems,
                            (select gems from public.user_wallets where profile_id = caller_id))
         );
end;
$$;


ALTER FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") IS 'Swap a daily mission. Charges gems per ladder. Anti-repeats against last 3 days + same-type active.';



CREATE OR REPLACE FUNCTION "public"."set_active_loading_screen"("p_id" "uuid") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized';
  end if;

  update public.loading_screen_images
  set is_active  = false,
      updated_by = auth.uid()
  where is_active
    and id <> p_id;

  update public.loading_screen_images
  set is_active  = true,
      updated_by = auth.uid()
  where id = p_id;

  if not found then
    raise exception 'loading screen % not found', p_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_active_loading_screen"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_active_podium"("p_id" "uuid") RETURNS "void"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'not authorized';
  end if;

  update public.podium_images
  set is_active  = false,
      updated_by = auth.uid()
  where is_active
    and id <> p_id;

  update public.podium_images
  set is_active  = true,
      updated_by = auth.uid()
  where id = p_id;

  if not found then
    raise exception 'podium % not found', p_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_active_podium"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
  LANGUAGE "plpgsql"
AS
$$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_cleanup_all"() RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  victim_ids uuid[];
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;

  select array_agg(id)
  into victim_ids
  from public.profiles
  where is_simulated = true;

  if victim_ids is null then return 0; end if;

  delete from public.profiles where id = any (victim_ids);
  delete from auth.users where id = any (victim_ids);

  return array_length(victim_ids, 1);
end;
$$;


ALTER FUNCTION "public"."simulate_cleanup_all"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_create_test_profile"("p_display_name" "text", "p_level" integer DEFAULT 1,
                                                                   "p_pvp_rating" integer DEFAULT 0) RETURNS "uuid"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$_$
declare
  new_id uuid := gen_random_uuid();
begin
  if not private.can_manage_config(auth.uid()) then raise exception 'forbidden'; end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user)
  values (new_id,
          '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated',
          'sim+' || new_id::text || '@gammon-rivals.test',
          '$2a$10$INVALID-SYNTHETIC-NO-LOGIN-PLACEHOLDER-HASH-AAA',
          now(), now(),
          '{
            "provider": "simulated",
            "providers": [
              "simulated"
            ]
          }'::jsonb,
          jsonb_build_object('display_name', '[sim] ' || p_display_name),
          false);

  -- The on_auth_user_created trigger created a default profiles row.
  update public.profiles
  set display_name = '[sim] ' || p_display_name,
      is_guest     = false,
      level        = p_level,
      xp           = 0,
      pvp_rating   = p_pvp_rating,
      is_simulated = true,
      avatar_seed  = 'sim-' || new_id::text,
      updated_at   = now()
  where id = new_id;

  insert into public.user_wallets (profile_id, coins, gems)
  values (new_id, 5000, 100)
  on conflict (profile_id) do update set coins = 5000, gems = 100;

  return new_id;
end;
$_$;


ALTER FUNCTION "public"."simulate_create_test_profile"("p_display_name" "text", "p_level" integer, "p_pvp_rating" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_get_test_user_state"("p_profile_id" "uuid") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  result jsonb;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;

  result := jsonb_build_object(
    'profile', (select jsonb_build_object(
                         'id', id, 'display_name', display_name, 'level', level,
                         'xp', xp, 'pvp_rating', pvp_rating
                       )
                from public.profiles
                where id = p_profile_id),
    'metrics', (select coalesce(jsonb_agg(jsonb_build_object(
                                            'metric_code', pm.metric_code,
                                            'baseline_7d', pm.baseline_7d,
                                            'tier', t.tier
                                          ) order by pm.metric_code), '[]'::jsonb)
                from public.player_metrics pm
                       left join public.player_metric_tiers t
                                 on t.profile_id = pm.profile_id and t.metric_code = pm.metric_code
                where pm.profile_id = p_profile_id),
    'missions', (select coalesce(jsonb_agg(jsonb_build_object(
                                             'id', pdm.id,
                                             'title', mt.title,
                                             'rarity', pdm.rarity_slot,
                                             'period', pdm.period,
                                             'mission_type', mt.mission_type,
                                             'metric_code', mt.metric_code,
                                             'resolution_mode', mt.resolution_mode,
                                             'resolved_goal', pdm.resolved_goal,
                                             'mission_points', mt.mission_points,
                                             'rewards', (select coalesce(jsonb_agg(jsonb_build_object(
                                                                                     'currency_code', mr.currency_code,
                                                                                     'amount', mr.amount
                                                                                   ) order by mr.display_order),
                                                                         '[]'::jsonb)
                                                         from public.mission_rewards mr
                                                         where mr.mission_id = mt.id)
                                           ) order by
                                             case pdm.rarity_slot
                                               when 'common' then 1
                                               when 'rare' then 2
                                               when 'epic' then 3
                                               else 4 end
                                 ), '[]'::jsonb)
                 from public.player_daily_missions pdm
                        join public.mission_templates mt on mt.id = pdm.mission_template_id
                 where pdm.profile_id = p_profile_id
                   and pdm.expires_at > now())
            );

  return result;
end;
$$;


ALTER FUNCTION "public"."simulate_get_test_user_state"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_list_test_profiles"() RETURNS "jsonb"
  LANGUAGE "sql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
select coalesce(jsonb_agg(jsonb_build_object(
                            'id', id, 'display_name', display_name, 'level', level,
                            'pvp_rating', pvp_rating, 'created_at', created_at
                          ) order by created_at desc), '[]'::jsonb)
from public.profiles
where is_simulated = true;
$$;


ALTER FUNCTION "public"."simulate_list_test_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_reset_today_missions"("p_profile_id" "uuid") RETURNS integer
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  cnt int;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;

  with deleted as (
    delete from public.player_daily_missions where profile_id = p_profile_id returning 1)
  select count(*)
  into cnt
  from deleted;
  return cnt;
end;
$$;


ALTER FUNCTION "public"."simulate_reset_today_missions"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_set_metric"("p_profile_id" "uuid", "p_metric_code" "text", "p_baseline" numeric) RETURNS "text"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  new_tier text;
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_simulated = true) then
    raise exception 'not_a_test_profile';
  end if;

  insert into public.player_metrics (profile_id, metric_code, value_today, baseline_7d)
  values (p_profile_id, p_metric_code, 0, p_baseline)
  on conflict (profile_id, metric_code) do update set baseline_7d = excluded.baseline_7d,
                                                      updated_at  = now();

  new_tier := case
                when p_baseline <= 0 then 'casual'
                when p_baseline >= coalesce(
                  (select value from public.metric_distributions where metric_code = p_metric_code and percentile = 66),
                  99999999
                                   ) then 'whale'
                when p_baseline >= coalesce(
                  (select value from public.metric_distributions where metric_code = p_metric_code and percentile = 33),
                  0
                                   ) then 'regular'
                else 'casual'
    end;

  insert into public.player_metric_tiers (profile_id, metric_code, tier)
  values (p_profile_id, p_metric_code, new_tier)
  on conflict (profile_id, metric_code) do update set tier       = excluded.tier,
                                                      updated_at = now();

  return new_tier;
end;
$$;


ALTER FUNCTION "public"."simulate_set_metric"("p_profile_id" "uuid", "p_metric_code" "text", "p_baseline" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."simulate_spawn_archetypes"("p_casuals" integer DEFAULT 5,
                                                                "p_regulars" integer DEFAULT 5,
                                                                "p_whales" integer DEFAULT 3) RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  new_id uuid;
  i      int;
  result jsonb := jsonb_build_object('casuals', 0, 'regulars', 0, 'whales', 0);
begin
  if not private.can_manage_config(auth.uid()) then
    raise exception 'forbidden';
  end if;

  for i in 1..p_casuals
    loop
      new_id := public.simulate_create_test_profile('casual ' || i, 5, 0);
      perform public.simulate_set_metric(new_id, 'matches_per_day', 1.0);
      perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 50);
      perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 20);
      perform public.simulate_set_metric(new_id, 'xp_per_day', 15);
      perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 0);
      perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 0.5);
      perform public.assign_daily_missions_for_profile(new_id);
    end loop;
  result := jsonb_set(result, '{casuals}', to_jsonb(p_casuals));

  for i in 1..p_regulars
    loop
      new_id := public.simulate_create_test_profile('regular ' || i, 15, 1200);
      perform public.simulate_set_metric(new_id, 'matches_per_day', 5.0);
      perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 500);
      perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 200);
      perform public.simulate_set_metric(new_id, 'xp_per_day', 75);
      perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 15);
      perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 2.0);
      perform public.simulate_set_metric(new_id, 'ranked_wins_per_week', 4);
      perform public.assign_daily_missions_for_profile(new_id);
    end loop;
  result := jsonb_set(result, '{regulars}', to_jsonb(p_regulars));

  for i in 1..p_whales
    loop
      new_id := public.simulate_create_test_profile('whale ' || i, 35, 1800);
      perform public.simulate_set_metric(new_id, 'matches_per_day', 15.0);
      perform public.simulate_set_metric(new_id, 'coins_wagered_per_day', 5000);
      perform public.simulate_set_metric(new_id, 'coins_won_net_per_day', 2000);
      perform public.simulate_set_metric(new_id, 'xp_per_day', 400);
      perform public.simulate_set_metric(new_id, 'gems_spent_per_day', 80);
      perform public.simulate_set_metric(new_id, 'wheel_spins_per_day', 5.0);
      perform public.simulate_set_metric(new_id, 'ranked_wins_per_week', 18);
      perform public.assign_daily_missions_for_profile(new_id);
    end loop;
  result := jsonb_set(result, '{whales}', to_jsonb(p_whales));

  -- Recompute distributions over the new population so tiers reflect
  -- the synthetic cohort, not just the prior real-player baseline.
  perform public.recompute_daily_mission_metrics();

  return result;
end;
$$;


ALTER FUNCTION "public"."simulate_spawn_archetypes"("p_casuals" integer, "p_regulars" integer, "p_whales" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."spin_wheel"("p_config_id" "text" DEFAULT 'main'::"text") RETURNS "jsonb"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id      uuid := auth.uid();
  cfg            public.wheel_configs;
  spin_row       public.user_wheel_spins;
  total_weight   int;
  random_pick    int;
  chosen         public.wheel_slots;
  wallet_row     public.user_wallets;
  profile_row    public.profiles;
  next_spin_at   timestamptz;
  credited_coins int  := 0;
  credited_gems  int  := 0;
  credited_xp    int  := 0;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  select * into cfg from public.wheel_configs where id = p_config_id for update;
  if not found then raise exception 'wheel_not_found'; end if;
  if not cfg.is_enabled then raise exception 'wheel_disabled'; end if;
  select *
  into spin_row
  from public.user_wheel_spins
  where profile_id = caller_id
    and config_id = p_config_id for update;
  if found and spin_row.last_spin_at is not null
    and spin_row.last_spin_at + (cfg.cooldown_seconds || ' seconds')::interval > now() then
    raise exception 'cooldown_not_elapsed';
  end if;
  select coalesce(sum(chance_basis_points), 0)
  into total_weight
  from public.wheel_slots
  where config_id = p_config_id
    and is_enabled;
  if total_weight <> 10000 then raise exception 'wheel_misconfigured'; end if;
  random_pick := floor(random() * total_weight)::int;
  if random_pick = total_weight then random_pick := total_weight - 1; end if;
  with cumulative as (select slot_index,
                             chance_basis_points,
                             sum(chance_basis_points) over (
                               order by slot_index rows between unbounded preceding and current row
                               ) as cum_sum
                      from public.wheel_slots
                      where config_id = p_config_id
                        and is_enabled)
  select s.*
  into chosen
  from public.wheel_slots s
         join cumulative c on c.slot_index = s.slot_index
  where s.config_id = p_config_id
    and c.cum_sum > random_pick
  order by s.slot_index asc
  limit 1;
  if chosen.config_id is null then raise exception 'wheel_no_slot_picked'; end if;

  insert into public.user_wallets (profile_id) values (caller_id) on conflict (profile_id) do nothing;

  case chosen.primary_reward_type
    when 'coins' then credited_coins := credited_coins + chosen.primary_reward_amount;
    when 'gems' then credited_gems := credited_gems + chosen.primary_reward_amount;
    when 'xp' then credited_xp := credited_xp + chosen.primary_reward_amount;
    else null;
    end case;

  if chosen.secondary_reward_type is not null then
    case chosen.secondary_reward_type
      when 'coins' then credited_coins := credited_coins + chosen.secondary_reward_amount;
      when 'gems' then credited_gems := credited_gems + chosen.secondary_reward_amount;
      when 'xp' then credited_xp := credited_xp + chosen.secondary_reward_amount;
      else null;
      end case;
  end if;

  if credited_coins > 0 or credited_gems > 0 then
    update public.user_wallets
    set coins = coins + credited_coins,
        gems  = gems + credited_gems
    where profile_id = caller_id
    returning * into wallet_row;
    if credited_coins > 0 then
      insert into public.wallet_transactions
      (profile_id, currency, amount, balance_after, source, reason, metadata, created_by)
      values (caller_id, 'coins', credited_coins, wallet_row.coins, 'wheel_spin',
              'Hourly wheel: ' || coalesce(chosen.label, 'slot ' || chosen.slot_index),
              jsonb_build_object('config_id', p_config_id, 'slot_index', chosen.slot_index,
                                 'credited_gems', credited_gems, 'credited_xp', credited_xp),
              caller_id);
    end if;
  else
    select * into wallet_row from public.user_wallets where profile_id = caller_id;
  end if;

  if credited_xp > 0 then
    update public.profiles
    set xp = xp + credited_xp
    where id = caller_id
    returning * into profile_row;
  else
    select * into profile_row from public.profiles where id = caller_id;
  end if;

  next_spin_at := now() + (cfg.cooldown_seconds || ' seconds')::interval;
  insert into public.user_wheel_spins
  (profile_id, config_id, last_spin_at, total_spins,
   last_slot_index, last_reward_coins, last_reward_gems, last_reward_xp)
  values (caller_id, p_config_id, now(), 1,
          chosen.slot_index, credited_coins, credited_gems, credited_xp)
  on conflict (profile_id) do update
    set last_spin_at      = excluded.last_spin_at,
        total_spins       = public.user_wheel_spins.total_spins + 1,
        last_slot_index   = excluded.last_slot_index,
        last_reward_coins = excluded.last_reward_coins,
        last_reward_gems  = excluded.last_reward_gems,
        last_reward_xp    = excluded.last_reward_xp,
        config_id         = excluded.config_id;

  perform public.progress_mission(
    caller_id, 'wheel_spins_per_day', 1,
    'spin:' || caller_id::text || ':' || clock_timestamp()::text);

  return jsonb_build_object(
    'slot_index', chosen.slot_index,
    'label', chosen.label,
    'accent_color', chosen.accent_color,
    'primary_reward', jsonb_build_object(
      'type', chosen.primary_reward_type,
      'amount', chosen.primary_reward_amount,
      'icon_url', chosen.primary_reward_icon_url
                      ),
    'secondary_reward', case
                          when chosen.secondary_reward_type is null then null
                          else jsonb_build_object(
                            'type', chosen.secondary_reward_type,
                            'amount', chosen.secondary_reward_amount,
                            'icon_url', chosen.secondary_reward_icon_url
                               )
      end,
    'credited_coins', credited_coins,
    'credited_gems', credited_gems,
    'credited_xp', credited_xp,
    'next_spin_at', next_spin_at,
    'wallet', jsonb_build_object('coins', wallet_row.coins, 'gems', wallet_row.gems),
    'profile', jsonb_build_object('xp', profile_row.xp, 'level', profile_row.level)
         );
end;
$$;


ALTER FUNCTION "public"."spin_wheel"("p_config_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."user_wallets"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
declare
  caller_id uuid := auth.uid(); target_id uuid; item_row public.shop_items;
begin
  if caller_id is null then raise exception 'not_authenticated'; end if;
  if not private.can_manage_config(caller_id) then raise exception 'not_authorized'; end if;
  target_id := coalesce(p_target_profile_id, caller_id);
  select * into item_row from public.shop_items where id = p_item_id;
  if not found then raise exception 'item_not_found'; end if;
  return private.apply_shop_grants_and_record(target_id, item_row, 'test', 'test:' || gen_random_uuid()::text);
end;
$$;


ALTER FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid") IS 'Admin-only (private.can_manage_config) test purchase: grants a shop item to the target (default caller) with NO payment, recorded as provider=test. Bypasses eligibility so draft offers can be validated; test rows never count toward max_purchases_per_user.';



CREATE OR REPLACE FUNCTION "public"."update_rating_on_match_finish"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public'
AS
$$
declare
  ai_rating  int;
  cur_rating int;
  expected   float;
  score      float;
  k_factor   int := 24;
  delta      int;
  white_id   uuid;
  black_id   uuid;
  white_r    int;
  black_r    int;
  white_exp  float;
begin
  if new.finished_at is null then return new; end if;
  if old.finished_at is not null then return new; end if;
  if new.winner is null then return new; end if;

  if new.mode = 'online' then
    if new.opponent_id is null then return new; end if;

    if new.owner_color = 'white' then
      white_id := new.owner_id;
      black_id := new.opponent_id;
    else
      white_id := new.opponent_id;
      black_id := new.owner_id;
    end if;

    select rating into white_r from public.profiles where id = white_id;
    select rating into black_r from public.profiles where id = black_id;
    if white_r is null or black_r is null then return new; end if;

    white_exp := 1.0 / (1.0 + power(10.0, (black_r - white_r)::float / 400.0));
    score := case when new.winner = 'white' then 1.0 else 0.0 end;
    delta := round(k_factor * (score - white_exp));

    update public.profiles set rating = greatest(0, white_r + delta) where id = white_id;
    update public.profiles set rating = greatest(0, black_r - delta) where id = black_id;
    return new;
  end if;

  if new.mode not like 'ai-%' then return new; end if;

  ai_rating := case new.mode
                 when 'ai-easy' then 1100
                 when 'ai-medium' then 1500
                 when 'ai-hard' then 1900
                 else 1500
    end;

  select rating into cur_rating from public.profiles where id = new.owner_id;
  if cur_rating is null then return new; end if;

  expected := 1.0 / (1.0 + power(10.0, (ai_rating - cur_rating)::float / 400.0));
  score := case when new.winner = 'white' then 1.0 else 0.0 end;
  delta := round(k_factor * (score - expected));

  update public.profiles set rating = greatest(0, cur_rating + delta) where id = new.owner_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."update_rating_on_match_finish"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wallet_transactions_progress_missions"() RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS
$$
begin
  if NEW.currency = 'coins' then
    if NEW.source = 'entry_fee' then
      perform public.progress_mission(NEW.profile_id, 'coins_wagered_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
    elsif NEW.source = 'match_reward' and NEW.amount > 0 then
      perform public.progress_mission(NEW.profile_id, 'coins_won_net_per_day', NEW.amount, 'wt:' || NEW.id::text);
    end if;
  end if;
  if NEW.currency = 'gems' and NEW.amount < 0 and NEW.source in ('purchase', 'mission_reroll_fee') then
    perform public.progress_mission(NEW.profile_id, 'gems_spent_per_day', abs(NEW.amount), 'wt:' || NEW.id::text);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."wallet_transactions_progress_missions"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log"
(
  "id"               "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "actor_profile_id" "uuid",
  "action"           "text"                                               NOT NULL,
  "entity_table"     "text"                                               NOT NULL,
  "entity_id"        "text"                                               NOT NULL,
  "before_value"     "jsonb",
  "after_value"      "jsonb",
  "created_at"       timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "admin_audit_log_action_check" CHECK (("action" = ANY
                                                    (ARRAY ['insert'::"text", 'update'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."admin_audit_log"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_email_allowlist"
(
  "email"      "text"                                   NOT NULL,
  "role"       "text"                                   NOT NULL,
  "note"       "text",
  "created_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "admin_email_allowlist_email_check" CHECK ((("email" = "lower"(TRIM(BOTH FROM "email"))) AND
                                                         ("email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::"text"))),
  CONSTRAINT "admin_email_allowlist_role_check" CHECK (("role" = ANY
                                                        (ARRAY ['owner'::"text", 'admin'::"text", 'support'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."admin_email_allowlist"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_roles"
(
  "profile_id" "uuid"                                   NOT NULL,
  "role"       "text"                                   NOT NULL,
  "note"       "text",
  "created_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "admin_roles_role_check" CHECK (("role" = ANY
                                              (ARRAY ['owner'::"text", 'admin'::"text", 'support'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."admin_roles"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_debug_log"
(
  "id"         bigint                                   NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "detail"     "text"
);


ALTER TABLE "public"."billing_debug_log"
  OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."billing_debug_log_id_seq"
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;


ALTER SEQUENCE "public"."billing_debug_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."billing_debug_log_id_seq" OWNED BY "public"."billing_debug_log"."id";



CREATE TABLE IF NOT EXISTS "public"."board_theme_configs"
(
  "id"                     "text"                                         NOT NULL,
  "display_name"           "text"                                         NOT NULL,
  "preview_image"          "text"                                         NOT NULL,
  "gameplay_image"         "text"                                         NOT NULL,
  "lobby_background_image" "text",
  "unlock_level"           integer                  DEFAULT 1             NOT NULL,
  "price_coins"            integer                  DEFAULT 0             NOT NULL,
  "is_enabled"             boolean                  DEFAULT true          NOT NULL,
  "is_featured"            boolean                  DEFAULT false         NOT NULL,
  "sort_order"             integer                  DEFAULT 0             NOT NULL,
  "metadata"               "jsonb"                  DEFAULT '{}'::"jsonb" NOT NULL,
  "updated_by"             "uuid",
  "created_at"             timestamp with time zone DEFAULT "now"()       NOT NULL,
  "updated_at"             timestamp with time zone DEFAULT "now"()       NOT NULL,
  "white_checker_image"    "text",
  "black_checker_image"    "text",
  "dice_image"             "text",
  "tray_image"             "text",
  "holder_image"           "text",
  "price_gems"             integer                  DEFAULT 0             NOT NULL,
  CONSTRAINT "board_theme_configs_id_check" CHECK (("id" ~ '^[a-z0-9][a-z0-9_-]*$'::"text")),
  CONSTRAINT "board_theme_configs_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
  CONSTRAINT "board_theme_configs_price_coins_check" CHECK (("price_coins" >= 0)),
  CONSTRAINT "board_theme_configs_price_gems_check" CHECK (("price_gems" >= 0)),
  CONSTRAINT "board_theme_configs_unlock_level_check" CHECK (("unlock_level" > 0))
);


ALTER TABLE "public"."board_theme_configs"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."board_theme_configs"."price_gems" IS 'Cost in gems to unlock this board theme. 0 = no gem purchase available. Players must also satisfy unlock_level before they can purchase.';



CREATE TABLE IF NOT EXISTS "public"."chest_milestones"
(
  "id"              "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "milestone_index" integer                                              NOT NULL,
  "threshold_mp"    integer                                              NOT NULL,
  "display_name"    "text"                                               NOT NULL,
  "rarity"          "text"                   DEFAULT 'common'::"text"    NOT NULL,
  "enabled"         boolean                  DEFAULT true                NOT NULL,
  "created_at"      timestamp with time zone DEFAULT "now"()             NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "chest_milestones_milestone_index_check" CHECK (("milestone_index" >= 0)),
  CONSTRAINT "chest_milestones_rarity_check" CHECK (("rarity" = ANY
                                                     (ARRAY ['common'::"text", 'rare'::"text", 'epic'::"text", 'legendary'::"text"]))),
  CONSTRAINT "chest_milestones_threshold_mp_check" CHECK (("threshold_mp" > 0))
);


ALTER TABLE "public"."chest_milestones"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chest_rewards"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "milestone_id"  "uuid"                                               NOT NULL,
  "reward_kind"   "text"                                               NOT NULL,
  "currency_code" "text",
  "item_table"    "text",
  "item_id"       "text",
  "amount"        integer                  DEFAULT 1                   NOT NULL,
  "display_order" integer                  DEFAULT 0                   NOT NULL,
  "created_at"    timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "chest_rewards_amount_check" CHECK (("amount" > 0)),
  CONSTRAINT "chest_rewards_check" CHECK ((
    (("reward_kind" = 'currency'::"text") AND ("currency_code" IS NOT NULL) AND ("item_table" IS NULL) AND
     ("item_id" IS NULL)) OR
    (("reward_kind" = 'item'::"text") AND ("currency_code" IS NULL) AND ("item_table" IS NOT NULL) AND
     ("item_id" IS NOT NULL)))),
  CONSTRAINT "chest_rewards_reward_kind_check" CHECK (("reward_kind" = ANY (ARRAY ['currency'::"text", 'item'::"text"])))
);


ALTER TABLE "public"."chest_rewards"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."currencies"
(
  "code"          "text"                                   NOT NULL,
  "display_name"  "text"                                   NOT NULL,
  "icon_url"      "text",
  "is_enabled"    boolean                  DEFAULT true    NOT NULL,
  "display_order" integer                  DEFAULT 0       NOT NULL,
  "created_at"    timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."currencies"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_bonus_configs"
(
  "day"          integer                                        NOT NULL,
  "reward_coins" integer                  DEFAULT 0             NOT NULL,
  "reward_gems"  integer                  DEFAULT 0             NOT NULL,
  "reward_xp"    integer                  DEFAULT 0             NOT NULL,
  "reward_items" "jsonb"                  DEFAULT '[]'::"jsonb" NOT NULL,
  "metadata"     "jsonb"                  DEFAULT '{}'::"jsonb" NOT NULL,
  "updated_by"   "uuid",
  "created_at"   timestamp with time zone DEFAULT "now"()       NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT "now"()       NOT NULL,
  CONSTRAINT "daily_bonus_configs_day_check" CHECK ((("day" >= 1) AND ("day" <= 7))),
  CONSTRAINT "daily_bonus_configs_reward_coins_check" CHECK (("reward_coins" >= 0)),
  CONSTRAINT "daily_bonus_configs_reward_gems_check" CHECK (("reward_gems" >= 0)),
  CONSTRAINT "daily_bonus_configs_reward_xp_check" CHECK (("reward_xp" >= 0))
);


ALTER TABLE "public"."daily_bonus_configs"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games"
(
  "id"             "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "match_id"       "uuid"                                               NOT NULL,
  "game_number"    integer                                              NOT NULL,
  "winner"         "text",
  "win_type"       "text",
  "cube_value"     integer                  DEFAULT 1                   NOT NULL,
  "cube_owner"     "text",
  "dropped_double" boolean                  DEFAULT false               NOT NULL,
  "points_awarded" integer                  DEFAULT 0                   NOT NULL,
  "was_crawford"   boolean                  DEFAULT false               NOT NULL,
  "started_at"     timestamp with time zone DEFAULT "now"()             NOT NULL,
  "finished_at"    timestamp with time zone,
  CONSTRAINT "games_cube_owner_check" CHECK (("cube_owner" = ANY (ARRAY ['white'::"text", 'black'::"text"]))),
  CONSTRAINT "games_win_type_check" CHECK (("win_type" = ANY
                                            (ARRAY ['single'::"text", 'gammon'::"text", 'backgammon'::"text"]))),
  CONSTRAINT "games_winner_check" CHECK (("winner" = ANY (ARRAY ['white'::"text", 'black'::"text"])))
);


ALTER TABLE "public"."games"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."level_configs"
(
  "level"        integer                                        NOT NULL,
  "xp_required"  integer                                        NOT NULL,
  "reward_coins" integer                  DEFAULT 0             NOT NULL,
  "reward_gems"  integer                  DEFAULT 0             NOT NULL,
  "reward_items" "jsonb"                  DEFAULT '[]'::"jsonb" NOT NULL,
  "unlock_rules" "jsonb"                  DEFAULT '{}'::"jsonb" NOT NULL,
  "is_enabled"   boolean                  DEFAULT true          NOT NULL,
  "updated_by"   "uuid",
  "created_at"   timestamp with time zone DEFAULT "now"()       NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT "now"()       NOT NULL,
  CONSTRAINT "level_configs_level_check" CHECK (("level" > 0)),
  CONSTRAINT "level_configs_reward_coins_check" CHECK (("reward_coins" >= 0)),
  CONSTRAINT "level_configs_reward_gems_check" CHECK (("reward_gems" >= 0)),
  CONSTRAINT "level_configs_reward_items_check" CHECK (("jsonb_typeof"("reward_items") = 'array'::"text")),
  CONSTRAINT "level_configs_unlock_rules_check" CHECK (("jsonb_typeof"("unlock_rules") = 'object'::"text")),
  CONSTRAINT "level_configs_xp_required_check" CHECK (("xp_required" >= 0))
);


ALTER TABLE "public"."level_configs"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."level_status_tiers"
(
  "id"         "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "level_from" integer                                              NOT NULL,
  "level_to"   integer                                              NOT NULL,
  "label"      "text"                                               NOT NULL,
  "sort_order" integer                  DEFAULT 0                   NOT NULL,
  "is_enabled" boolean                  DEFAULT true                NOT NULL,
  "updated_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"()             NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "level_status_tiers_check" CHECK (("level_to" >= "level_from")),
  CONSTRAINT "level_status_tiers_label_check" CHECK (("length"(TRIM(BOTH FROM "label")) > 0)),
  CONSTRAINT "level_status_tiers_level_from_check" CHECK (("level_from" > 0)),
  CONSTRAINT "level_status_tiers_level_to_check" CHECK (("level_to" > 0))
);


ALTER TABLE "public"."level_status_tiers"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."level_status_tiers" IS 'Maps a player-level range to a rank label (Rookie, Skilled, etc.). The lobby derives the displayed status_label from this table; level_configs.status_label is a legacy fallback.';



CREATE TABLE IF NOT EXISTS "public"."loading_screen_images"
(
  "id"         "uuid"                   DEFAULT "gen_random_uuid"()      NOT NULL,
  "name"       "text"                   DEFAULT 'Loading screen'::"text" NOT NULL,
  "image_url"  "text"                                                    NOT NULL,
  "is_active"  boolean                  DEFAULT false                    NOT NULL,
  "sort_order" integer                  DEFAULT 0                        NOT NULL,
  "updated_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"()                  NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"()                  NOT NULL,
  CONSTRAINT "loading_screen_images_image_url_check" CHECK (("length"(TRIM(BOTH FROM "image_url")) > 0)),
  CONSTRAINT "loading_screen_images_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."loading_screen_images"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."loading_screen_images" IS 'BO-managed library of full-screen loading-screen art. Exactly one row is_active at a time; the client renders that one (cached in localStorage for cold starts). Use set_active_loading_screen() to switch.';



CREATE TABLE IF NOT EXISTS "public"."lobby_feature_configs"
(
  "id"           "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "feature_key"  "text"                                               NOT NULL,
  "label"        "text"                                               NOT NULL,
  "unlock_level" integer                  DEFAULT 1                   NOT NULL,
  "is_enabled"   boolean                  DEFAULT true                NOT NULL,
  "sort_order"   integer                  DEFAULT 0                   NOT NULL,
  "created_at"   timestamp with time zone DEFAULT "now"()             NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT "now"()             NOT NULL,
  "tooltip_text" "text",
  CONSTRAINT "lobby_feature_configs_unlock_level_check" CHECK (("unlock_level" >= 1))
);


ALTER TABLE "public"."lobby_feature_configs"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."matches"
(
  "id"                   "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "owner_id"             "uuid"                                               NOT NULL,
  "mode"                 "text"                                               NOT NULL,
  "target"               integer                                              NOT NULL,
  "white_score"          integer                  DEFAULT 0                   NOT NULL,
  "black_score"          integer                  DEFAULT 0                   NOT NULL,
  "winner"               "text",
  "crawford_game_number" integer,
  "started_at"           timestamp with time zone DEFAULT "now"()             NOT NULL,
  "finished_at"          timestamp with time zone,
  "updated_at"           timestamp with time zone DEFAULT "now"()             NOT NULL,
  "opponent_id"          "uuid",
  "owner_color"          "text"                   DEFAULT 'white'::"text"     NOT NULL,
  "invite_code"          "text",
  "invite_expires_at"    timestamp with time zone,
  "current_turn"         "jsonb",
  "current_game_id"      "uuid",
  "cube_value"           integer                  DEFAULT 1                   NOT NULL,
  "cube_owner"           "text",
  "cube_offer"           "text",
  "is_public"            boolean                  DEFAULT false               NOT NULL,
  "table_config_id"      "text",
  "entry_fee_paid_at"    timestamp with time zone,
  "is_bot"               boolean                  DEFAULT false               NOT NULL,
  "bot_level"            "text",
  CONSTRAINT "matches_cube_offer_check" CHECK (("cube_offer" = ANY (ARRAY ['white'::"text", 'black'::"text"]))),
  CONSTRAINT "matches_cube_owner_check" CHECK (("cube_owner" = ANY (ARRAY ['white'::"text", 'black'::"text"]))),
  CONSTRAINT "matches_mode_check" CHECK (("mode" = ANY
                                          (ARRAY ['hotseat'::"text", 'ai-easy'::"text", 'ai-medium'::"text", 'ai-hard'::"text", 'online'::"text"]))),
  CONSTRAINT "matches_owner_color_check" CHECK (("owner_color" = ANY (ARRAY ['white'::"text", 'black'::"text"]))),
  CONSTRAINT "matches_target_check" CHECK (("target" >= 1)),
  CONSTRAINT "matches_winner_check" CHECK (("winner" = ANY (ARRAY ['white'::"text", 'black'::"text"])))
);


ALTER TABLE "public"."matches"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."matches"."table_config_id" IS 'Difficulty/room this match was started from. Used at match-end to look up turn timer, XP multiplier, and coin reward.';



COMMENT ON COLUMN "public"."matches"."entry_fee_paid_at" IS 'Set by enter_room / enter_room_ai_fallback / find_match_in_tier when a tiered match is created. finish_match pays coins/XP/rating ONLY when non-null (proof the match is economy-bearing). Clients cannot set it via direct INSERT.';



COMMENT ON COLUMN "public"."matches"."is_bot" IS 'Phase 2b layer 2: true for an online match whose opponent is a server bot (opponent_id stays null). roll_dice accepts it; ai_move / commit_ai_turn drive the bot side.';



COMMENT ON COLUMN "public"."matches"."bot_level" IS 'AI difficulty for a bot match (easy/medium/hard); null for human matches.';



CREATE TABLE IF NOT EXISTS "public"."matchmaking_queue"
(
  "profile_id"       "uuid"                                   NOT NULL,
  "target"           integer                                  NOT NULL,
  "rating"           integer                                  NOT NULL,
  "matched_match_id" "uuid",
  "created_at"       timestamp with time zone DEFAULT "now"() NOT NULL,
  "table_config_id"  "text",
  CONSTRAINT "matchmaking_queue_target_check" CHECK (("target" >= 1))
);


ALTER TABLE "public"."matchmaking_queue"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."matchmaking_queue"."table_config_id" IS 'The tier this caller is searching within. Null entries belong to the legacy public-lobby matchmake flow; tier-aware searches via find_match_in_tier set this so the queue can pair by tier+ELO rather than just target.';



CREATE TABLE IF NOT EXISTS "public"."metric_distributions"
(
  "metric_code" "text"                                   NOT NULL,
  "percentile"  integer                                  NOT NULL,
  "value"       numeric(12, 2)                           NOT NULL,
  "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "metric_distributions_percentile_check" CHECK ((("percentile" >= 0) AND ("percentile" <= 100)))
);


ALTER TABLE "public"."metric_distributions"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mission_progress_events"
(
  "event_id"     "text"                                   NOT NULL,
  "profile_id"   "uuid"                                   NOT NULL,
  "metric_code"  "text"                                   NOT NULL,
  "delta"        integer                                  NOT NULL,
  "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mission_progress_events"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mission_rerolls"
(
  "id"                      "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"              "uuid"                                               NOT NULL,
  "rerolled_at"             timestamp with time zone DEFAULT "now"()             NOT NULL,
  "gem_cost"                integer                                              NOT NULL,
  "prior_template_id"       "uuid",
  "new_template_id"         "uuid",
  "player_daily_mission_id" "uuid",
  CONSTRAINT "mission_rerolls_gem_cost_check" CHECK (("gem_cost" >= 0))
);


ALTER TABLE "public"."mission_rerolls"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mission_rewards"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "mission_id"    "uuid"                                               NOT NULL,
  "reward_kind"   "text"                                               NOT NULL,
  "currency_code" "text",
  "item_table"    "text",
  "item_id"       "text",
  "amount"        integer                  DEFAULT 1                   NOT NULL,
  "display_order" integer                  DEFAULT 0                   NOT NULL,
  "created_at"    timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "mission_rewards_amount_check" CHECK (("amount" > 0)),
  CONSTRAINT "mission_rewards_check" CHECK ((
    (("reward_kind" = 'currency'::"text") AND ("currency_code" IS NOT NULL) AND ("item_table" IS NULL) AND
     ("item_id" IS NULL)) OR
    (("reward_kind" = 'item'::"text") AND ("currency_code" IS NULL) AND ("item_table" IS NOT NULL) AND
     ("item_id" IS NOT NULL)))),
  CONSTRAINT "mission_rewards_reward_kind_check" CHECK (("reward_kind" = ANY (ARRAY ['currency'::"text", 'item'::"text"])))
);


ALTER TABLE "public"."mission_rewards"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mission_type_config"
(
  "mission_type"          "text"                                   NOT NULL,
  "metric_code"           "text"                                   NOT NULL,
  "label"                 "text"                                   NOT NULL,
  "description"           "text",
  "is_wired"              boolean                  DEFAULT true    NOT NULL,
  "supports_personalized" boolean                  DEFAULT false   NOT NULL,
  "base_stretch"          numeric                  DEFAULT 1.3     NOT NULL,
  "up_step"               integer                  DEFAULT 1       NOT NULL,
  "ease_after"            integer                  DEFAULT 2       NOT NULL,
  "ease_factor"           numeric                  DEFAULT 0.75    NOT NULL,
  "floor_mult"            numeric                  DEFAULT 0.5     NOT NULL,
  "cap_mult"              numeric                  DEFAULT 2.0     NOT NULL,
  "reward_pct"            numeric                  DEFAULT 0.10    NOT NULL,
  "floor_reward"          integer                  DEFAULT 250     NOT NULL,
  "round_to"              integer                  DEFAULT 50      NOT NULL,
  "baseline_window_days"  integer                  DEFAULT 30      NOT NULL,
  "created_at"            timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT "now"() NOT NULL,
  "goal_round_to"         integer                  DEFAULT 1       NOT NULL,
  "rollout_pct"           integer                  DEFAULT 0       NOT NULL,
  CONSTRAINT "mtc_base_stretch_ck" CHECK (("base_stretch" >= (1)::numeric)),
  CONSTRAINT "mtc_cap_mult_ck" CHECK (("cap_mult" >= (1)::numeric)),
  CONSTRAINT "mtc_ease_after_ck" CHECK (("ease_after" >= 1)),
  CONSTRAINT "mtc_floor_mult_ck" CHECK ((("floor_mult" > (0)::numeric) AND ("floor_mult" <= (1)::numeric))),
  CONSTRAINT "mtc_floor_reward_ck" CHECK (("floor_reward" >= 0)),
  CONSTRAINT "mtc_goal_round_ck" CHECK (("goal_round_to" >= 1)),
  CONSTRAINT "mtc_reward_pct_ck" CHECK ((("reward_pct" >= (0)::numeric) AND ("reward_pct" < (1)::numeric))),
  CONSTRAINT "mtc_rollout_pct_ck" CHECK ((("rollout_pct" >= 0) AND ("rollout_pct" <= 100))),
  CONSTRAINT "mtc_round_ck" CHECK (("round_to" >= 1)),
  CONSTRAINT "mtc_up_step_ck" CHECK (("up_step" >= 0)),
  CONSTRAINT "mtc_window_ck" CHECK (("baseline_window_days" >= 1))
);


ALTER TABLE "public"."mission_type_config"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."mission_type_config" IS 'Per-mission-type registry + tunable config. metric_code binds the type to its progress event; is_wired flags whether that event is actually emitted; coefficient columns drive the personalized adaptive controller (docs/daily-missions-redesign.md §G). Coefficients are DATA, edited in the BO, read by mp_assign_*.';



CREATE TABLE IF NOT EXISTS "public"."moves"
(
  "id"         bigint                                   NOT NULL,
  "game_id"    "uuid"                                   NOT NULL,
  "ply"        integer                                  NOT NULL,
  "player"     "text"                                   NOT NULL,
  "dice"       integer[]                                NOT NULL,
  "sub_moves"  "jsonb"                                  NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "elapsed_ms" integer,
  CONSTRAINT "moves_elapsed_ms_check" CHECK ((("elapsed_ms" IS NULL) OR ("elapsed_ms" >= 0))),
  CONSTRAINT "moves_player_check" CHECK (("player" = ANY (ARRAY ['white'::"text", 'black'::"text"])))
);


ALTER TABLE "public"."moves"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."moves"."elapsed_ms" IS 'Player''s think-time on this ply, in milliseconds (roll until submit). Nullable: AI turns and pre-column rows have no value. Used as raw signal for future bot detection.';



CREATE SEQUENCE IF NOT EXISTS "public"."moves_id_seq"
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;


ALTER SEQUENCE "public"."moves_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."moves_id_seq" OWNED BY "public"."moves"."id";



CREATE TABLE IF NOT EXISTS "public"."player_grants"
(
  "id"          "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"  "uuid"                                               NOT NULL,
  "trigger_key" "text"                                               NOT NULL,
  "coins"       integer                  DEFAULT 0                   NOT NULL,
  "gems"        integer                  DEFAULT 0                   NOT NULL,
  "granted_at"  timestamp with time zone DEFAULT "now"()             NOT NULL
);


ALTER TABLE "public"."player_grants"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_metric_tiers"
(
  "profile_id"  "uuid"                                   NOT NULL,
  "metric_code" "text"                                   NOT NULL,
  "tier"        "text"                                   NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "player_metric_tiers_tier_check" CHECK (("tier" = ANY
                                                      (ARRAY ['casual'::"text", 'regular'::"text", 'whale'::"text"])))
);


ALTER TABLE "public"."player_metric_tiers"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_metrics"
(
  "profile_id"  "uuid"                                   NOT NULL,
  "metric_code" "text"                                   NOT NULL,
  "value_today" integer                  DEFAULT 0       NOT NULL,
  "baseline_7d" numeric(12, 2)           DEFAULT 0       NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_metrics"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_mission_difficulty"
(
  "profile_id"            "uuid"                                   NOT NULL,
  "mission_type"          "text"                                   NOT NULL,
  "target"                integer                                  NOT NULL,
  "last_completed_target" integer,
  "consecutive_misses"    integer                  DEFAULT 0       NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_mission_difficulty"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."player_mission_difficulty" IS 'Adaptive-difficulty controller state per (player, mission_type): current target, last completed target, consecutive misses. Drives the personalized goal; server-only.';



CREATE TABLE IF NOT EXISTS "public"."player_streak"
(
  "profile_id"                  "uuid"                                   NOT NULL,
  "current_streak_days"         integer                  DEFAULT 0       NOT NULL,
  "last_complete_date"          "date",
  "total_streak_chests_claimed" integer                  DEFAULT 0       NOT NULL,
  "updated_at"                  timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "player_streak_current_streak_days_check" CHECK (("current_streak_days" >= 0)),
  CONSTRAINT "player_streak_total_streak_chests_claimed_check" CHECK (("total_streak_chests_claimed" >= 0))
);


ALTER TABLE "public"."player_streak"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_weekly_pass"
(
  "profile_id"          "uuid"                                         NOT NULL,
  "week_key"            "text"                                         NOT NULL,
  "mp_earned"           integer                  DEFAULT 0             NOT NULL,
  "chests_claimed"      "jsonb"                  DEFAULT '[]'::"jsonb" NOT NULL,
  "streak_bonus_active" boolean                  DEFAULT false         NOT NULL,
  "created_at"          timestamp with time zone DEFAULT "now"()       NOT NULL,
  "updated_at"          timestamp with time zone DEFAULT "now"()       NOT NULL,
  CONSTRAINT "player_weekly_pass_mp_earned_check" CHECK (("mp_earned" >= 0))
);


ALTER TABLE "public"."player_weekly_pass"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."podium_images"
(
  "id"         "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "name"       "text"                   DEFAULT 'Podium'::"text"    NOT NULL,
  "image_url"  "text"                                               NOT NULL,
  "is_active"  boolean                  DEFAULT false               NOT NULL,
  "sort_order" integer                  DEFAULT 0                   NOT NULL,
  "updated_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"()             NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "podium_images_image_url_check" CHECK (("length"(TRIM(BOTH FROM "image_url")) > 0)),
  CONSTRAINT "podium_images_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."podium_images"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."podium_images" IS 'BO-managed library of carousel podium images (the stand the board sits on). Exactly one row is_active at a time; the lobby renders that one. Use set_active_podium() to switch.';



CREATE TABLE IF NOT EXISTS "public"."profiles"
(
  "id"                    "uuid"                                           NOT NULL,
  "display_name"          "text"                                           NOT NULL,
  "is_guest"              boolean                  DEFAULT false           NOT NULL,
  "created_at"            timestamp with time zone DEFAULT "now"()         NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT "now"()         NOT NULL,
  "rating"                integer                  DEFAULT 1500            NOT NULL,
  "avatar_seed"           "text"                   DEFAULT "substr"(
    "md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 12) NOT NULL,
  "level"                 integer                  DEFAULT 1               NOT NULL,
  "xp"                    integer                  DEFAULT 0               NOT NULL,
  "is_suspended"          boolean                  DEFAULT false           NOT NULL,
  "suspended_at"          timestamp with time zone,
  "suspension_reason"     "text",
  "admin_note"            "text",
  "last_seen_at"          timestamp with time zone,
  "pvp_rating"            integer                  DEFAULT 1500            NOT NULL,
  "is_simulated"          boolean                  DEFAULT false           NOT NULL,
  "tutorial_completed_at" timestamp with time zone,
  CONSTRAINT "profiles_level_check" CHECK (("level" > 0)),
  CONSTRAINT "profiles_pvp_rating_check" CHECK ((("pvp_rating" >= 0) AND ("pvp_rating" <= 4000))),
  CONSTRAINT "profiles_xp_check" CHECK (("xp" >= 0))
);


ALTER TABLE "public"."profiles"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."pvp_rating" IS 'ELO-style PvP rating. Moves only on PvP match completion (both sides human). 1500 = neutral starting rating; clamps at [0, 4000] so a broken update cant corrupt the column.';



COMMENT ON COLUMN "public"."profiles"."tutorial_completed_at" IS 'When the player finished or skipped the first-run onboarding tour. NULL = not seen yet. Set via public.mark_tutorial_complete().';



CREATE TABLE IF NOT EXISTS "public"."purchases"
(
  "id"                      "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"              "uuid"                                               NOT NULL,
  "product_id"              "text"                                               NOT NULL,
  "product_type"            "text"                                               NOT NULL,
  "provider"                "text"                   DEFAULT 'admin'::"text"     NOT NULL,
  "provider_transaction_id" "text",
  "price_cents"             integer,
  "currency_code"           "text"                   DEFAULT 'USD'::"text"       NOT NULL,
  "contents"                "jsonb"                  DEFAULT '{}'::"jsonb"       NOT NULL,
  "status"                  "text"                   DEFAULT 'completed'::"text" NOT NULL,
  "created_at"              timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "purchases_contents_check" CHECK (("jsonb_typeof"("contents") = 'object'::"text")),
  CONSTRAINT "purchases_price_cents_check" CHECK ((("price_cents" IS NULL) OR ("price_cents" >= 0))),
  CONSTRAINT "purchases_product_type_check" CHECK (("product_type" = ANY
                                                    (ARRAY ['coin_pack'::"text", 'gem_pack'::"text", 'board_theme'::"text", 'cosmetic'::"text", 'bundle'::"text", 'special_offer'::"text"]))),
  CONSTRAINT "purchases_provider_check" CHECK (("provider" = ANY
                                                (ARRAY ['apple'::"text", 'google'::"text", 'stripe'::"text", 'admin'::"text", 'test'::"text", 'gems'::"text", 'coins'::"text"]))),
  CONSTRAINT "purchases_status_check" CHECK (("status" = ANY
                                              (ARRAY ['pending'::"text", 'completed'::"text", 'failed'::"text", 'refunded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."purchases"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reroll_pricing_config"
(
  "id"              "text"                   DEFAULT 'default'::"text"      NOT NULL,
  "gem_cost_ladder" integer[]                DEFAULT ARRAY [0, 25, 75, 200] NOT NULL,
  "daily_cap"       integer                  DEFAULT 4                      NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT "now"()                NOT NULL,
  CONSTRAINT "reroll_pricing_config_daily_cap_check" CHECK (("daily_cap" > 0))
);


ALTER TABLE "public"."reroll_pricing_config"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."store_config"
(
  "id"           boolean                  DEFAULT true            NOT NULL,
  "title"        "text"                   DEFAULT 'Store'::"text" NOT NULL,
  "bg_image_url" "text",
  "updated_at"   timestamp with time zone DEFAULT "now"()         NOT NULL,
  CONSTRAINT "store_config_singleton" CHECK (("id" = true))
);


ALTER TABLE "public"."store_config"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."store_sales"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"()  NOT NULL,
  "label"         "text"                   DEFAULT 'Store Sale'::"text" NOT NULL,
  "bonus_percent" integer                  DEFAULT 0                    NOT NULL,
  "is_active"     boolean                  DEFAULT false                NOT NULL,
  "starts_at"     timestamp with time zone,
  "ends_at"       timestamp with time zone,
  "created_at"    timestamp with time zone DEFAULT "now"()              NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT "now"()              NOT NULL,
  CONSTRAINT "store_sales_bonus_percent_check" CHECK ((("bonus_percent" >= 0) AND ("bonus_percent" <= 1000)))
);


ALTER TABLE "public"."store_sales"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."streak_chest_rewards"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "reward_kind"   "text"                                               NOT NULL,
  "currency_code" "text",
  "item_table"    "text",
  "item_id"       "text",
  "amount"        integer                  DEFAULT 1                   NOT NULL,
  "display_order" integer                  DEFAULT 0                   NOT NULL,
  "created_at"    timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "streak_chest_rewards_amount_check" CHECK (("amount" > 0)),
  CONSTRAINT "streak_chest_rewards_check" CHECK ((
    (("reward_kind" = 'currency'::"text") AND ("currency_code" IS NOT NULL) AND ("item_table" IS NULL) AND
     ("item_id" IS NULL)) OR
    (("reward_kind" = 'item'::"text") AND ("currency_code" IS NULL) AND ("item_table" IS NOT NULL) AND
     ("item_id" IS NOT NULL)))),
  CONSTRAINT "streak_chest_rewards_reward_kind_check" CHECK (("reward_kind" = ANY (ARRAY ['currency'::"text", 'item'::"text"])))
);


ALTER TABLE "public"."streak_chest_rewards"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_configs"
(
  "id"                "text"                                              NOT NULL,
  "display_name"      "text"                                              NOT NULL,
  "description"       "text"                   DEFAULT ''::"text"         NOT NULL,
  "entry_fee_coins"   integer                  DEFAULT 0                  NOT NULL,
  "prize_coins"       integer                  DEFAULT 0                  NOT NULL,
  "required_level"    integer                  DEFAULT 1                  NOT NULL,
  "match_target"      integer                  DEFAULT 7                  NOT NULL,
  "allow_ai"          boolean                  DEFAULT false              NOT NULL,
  "allow_online"      boolean                  DEFAULT true               NOT NULL,
  "is_enabled"        boolean                  DEFAULT true               NOT NULL,
  "sort_order"        integer                  DEFAULT 0                  NOT NULL,
  "metadata"          "jsonb"                  DEFAULT '{}'::"jsonb"      NOT NULL,
  "updated_by"        "uuid",
  "created_at"        timestamp with time zone DEFAULT "now"()            NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT "now"()            NOT NULL,
  "kind"              "text"                   DEFAULT 'standard'::"text" NOT NULL,
  "xp_multiplier_pct" integer                  DEFAULT 100                NOT NULL,
  "base_xp_win"       integer                  DEFAULT 0                  NOT NULL,
  "turn_seconds"      integer                  DEFAULT 45                 NOT NULL,
  "accent_color"      "text"                   DEFAULT 'gold'::"text"     NOT NULL,
  "prize_coins_loss"  integer                  DEFAULT 0                  NOT NULL,
  "ai_level"          "text"                   DEFAULT 'medium'::"text"   NOT NULL,
  "target_rtp_pct"    integer                  DEFAULT 90                 NOT NULL,
  "allow_online_pvp"  boolean                  DEFAULT false              NOT NULL,
  "pvp_rake_pct"      integer                  DEFAULT 10                 NOT NULL,
  "server_bot"        boolean                  DEFAULT false              NOT NULL,
  CONSTRAINT "table_configs_ai_level_check" CHECK (("ai_level" = ANY
                                                    (ARRAY ['easy'::"text", 'medium'::"text", 'hard'::"text"]))),
  CONSTRAINT "table_configs_base_xp_win_check" CHECK (("base_xp_win" >= 0)),
  CONSTRAINT "table_configs_entry_fee_coins_check" CHECK (("entry_fee_coins" >= 0)),
  CONSTRAINT "table_configs_id_check" CHECK (("id" ~ '^[a-z0-9][a-z0-9_-]*$'::"text")),
  CONSTRAINT "table_configs_kind_check" CHECK (("kind" = ANY (ARRAY ['standard'::"text", 'difficulty'::"text"]))),
  CONSTRAINT "table_configs_match_target_check" CHECK (("match_target" > 0)),
  CONSTRAINT "table_configs_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
  CONSTRAINT "table_configs_prize_coins_check" CHECK (("prize_coins" >= 0)),
  CONSTRAINT "table_configs_prize_coins_loss_check" CHECK (("prize_coins_loss" >= 0)),
  CONSTRAINT "table_configs_pvp_rake_pct_check" CHECK ((("pvp_rake_pct" >= 0) AND ("pvp_rake_pct" <= 100))),
  CONSTRAINT "table_configs_required_level_check" CHECK (("required_level" > 0)),
  CONSTRAINT "table_configs_target_rtp_pct_check" CHECK ((("target_rtp_pct" >= 0) AND ("target_rtp_pct" <= 200))),
  CONSTRAINT "table_configs_turn_seconds_check" CHECK ((("turn_seconds" >= 5) AND ("turn_seconds" <= 600))),
  CONSTRAINT "table_configs_xp_multiplier_pct_check" CHECK ((("xp_multiplier_pct" >= 0) AND ("xp_multiplier_pct" <= 10000)))
);


ALTER TABLE "public"."table_configs"
  OWNER TO "postgres";


COMMENT ON COLUMN "public"."table_configs"."kind" IS 'Distinguishes ad-hoc rooms (standard: Practice AI, Play Online, etc.) from the five-tier difficulty ladder shown in the lobby modal.';



COMMENT ON COLUMN "public"."table_configs"."xp_multiplier_pct" IS 'Percent multiplier applied to base_xp_win on a win (100 = x1, 500 = x5). Displayed as the "XP BOOST" value on the difficulty card.';



COMMENT ON COLUMN "public"."table_configs"."base_xp_win" IS 'Raw XP credited for a win in this room before the multiplier and the player''s user_xp_boosts buff.';



COMMENT ON COLUMN "public"."table_configs"."turn_seconds" IS 'Per-turn time limit for matches created in this room. Overrides the legacy DEFAULT_TURN_SECONDS client constant.';



COMMENT ON COLUMN "public"."table_configs"."accent_color" IS 'Free-form accent slug consumed by the modal card frame (e.g. green/blue/purple/red/gold).';



COMMENT ON COLUMN "public"."table_configs"."prize_coins_loss" IS 'Coins refunded to the match owner on a loss. Pairs with prize_coins (win). Together with entry_fee_coins drives RTP at the assumed win probability.';



COMMENT ON COLUMN "public"."table_configs"."ai_level" IS 'AI strength this tier uses. enter_room maps this to match.mode as ai-<level>; the win-streak escalator can bump one step harder for streaking players.';



COMMENT ON COLUMN "public"."table_configs"."target_rtp_pct" IS 'Designer''s RTP target for this tier (percent). Used by the BO dashboard to compare actual vs target; not consumed by the runtime math.';



COMMENT ON COLUMN "public"."table_configs"."allow_online_pvp" IS 'Operator switch: if true, the tier participates in PvP matchmaking. If false, every PLAY goes straight to AI without a search.';



COMMENT ON COLUMN "public"."table_configs"."pvp_rake_pct" IS 'House rake (percent of total pot) applied to PvP matches. finish_match derives winner_prize = pot - rake - prize_coins_loss; the loser still receives prize_coins_loss. The vs-AI payout columns (prize_coins, prize_coins_loss) are independent.';



COMMENT ON COLUMN "public"."table_configs"."server_bot" IS 'Phase 2b layer 2: when true, this tier''s vs-AI matches run as a server bot on the online path (mode=online + is_bot, server-authoritative) instead of client-side HotSeat (mode=ai-%). Default false = legacy HotSeat. Flip per-tier to roll out.';



CREATE TABLE IF NOT EXISTS "public"."user_board_inventory"
(
  "profile_id"     "uuid"                                                 NOT NULL,
  "board_theme_id" "text"                                                 NOT NULL,
  "source"         "text"                   DEFAULT 'admin_grant'::"text" NOT NULL,
  "granted_by"     "uuid",
  "created_at"     timestamp with time zone DEFAULT "now"()               NOT NULL,
  CONSTRAINT "user_board_inventory_source_check" CHECK (("source" = ANY
                                                         (ARRAY ['default'::"text", 'purchase'::"text", 'level_reward'::"text", 'admin_grant'::"text", 'bundle'::"text", 'daily_bonus'::"text"])))
);


ALTER TABLE "public"."user_board_inventory"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_daily_bonuses"
(
  "profile_id"         "uuid"                                   NOT NULL,
  "current_day"        integer                  DEFAULT 1       NOT NULL,
  "last_claim_date_et" "date",
  "last_claim_at"      timestamp with time zone,
  "created_at"         timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "user_daily_bonuses_current_day_check" CHECK ((("current_day" >= 1) AND ("current_day" <= 7)))
);


ALTER TABLE "public"."user_daily_bonuses"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_inventory"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"    "uuid"                                               NOT NULL,
  "item_table"    "text"                                               NOT NULL,
  "item_id"       "text"                                               NOT NULL,
  "granted_at"    timestamp with time zone DEFAULT "now"()             NOT NULL,
  "source"        "text"                                               NOT NULL,
  "source_ref_id" "text"
);


ALTER TABLE "public"."user_inventory"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_wheel_spins"
(
  "profile_id"        "uuid"            NOT NULL,
  "config_id"         "text"            NOT NULL,
  "last_spin_at"      timestamp with time zone,
  "total_spins"       integer DEFAULT 0 NOT NULL,
  "last_slot_index"   integer,
  "last_reward_coins" integer DEFAULT 0 NOT NULL,
  "last_reward_gems"  integer DEFAULT 0 NOT NULL,
  "last_reward_xp"    integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."user_wheel_spins"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_xp_boosts"
(
  "id"           "uuid"                   DEFAULT "gen_random_uuid"() NOT NULL,
  "profile_id"   "uuid"                                               NOT NULL,
  "multiplier"   integer                                              NOT NULL,
  "expires_at"   timestamp with time zone                             NOT NULL,
  "source"       "text"                                               NOT NULL,
  "shop_item_id" "text",
  "created_at"   timestamp with time zone DEFAULT "now"()             NOT NULL,
  CONSTRAINT "user_xp_boosts_multiplier_check" CHECK ((("multiplier" >= 2) AND ("multiplier" <= 10))),
  CONSTRAINT "user_xp_boosts_source_check" CHECK (("source" = ANY
                                                   (ARRAY ['purchase'::"text", 'admin'::"text", 'daily_bonus'::"text", 'event'::"text", 'test'::"text"])))
);


ALTER TABLE "public"."user_xp_boosts"
  OWNER TO "postgres";


COMMENT ON TABLE "public"."user_xp_boosts" IS 'Time-limited XP multipliers earned by a player. Highest active multiplier wins (no additive stacking). Writes only via SECURITY DEFINER RPCs.';



CREATE TABLE IF NOT EXISTS "public"."wallet_transactions"
(
  "id"            "uuid"                   DEFAULT "gen_random_uuid"()        NOT NULL,
  "profile_id"    "uuid"                                                      NOT NULL,
  "currency"      "text"                                                      NOT NULL,
  "amount"        integer                                                     NOT NULL,
  "balance_after" integer                                                     NOT NULL,
  "source"        "text"                   DEFAULT 'admin_adjustment'::"text" NOT NULL,
  "reason"        "text"                                                      NOT NULL,
  "metadata"      "jsonb"                  DEFAULT '{}'::"jsonb"              NOT NULL,
  "created_by"    "uuid",
  "created_at"    timestamp with time zone DEFAULT "now"()                    NOT NULL,
  CONSTRAINT "wallet_transactions_amount_check" CHECK (("amount" <> 0)),
  CONSTRAINT "wallet_transactions_balance_after_check" CHECK (("balance_after" >= 0)),
  CONSTRAINT "wallet_transactions_currency_check" CHECK (("currency" = ANY (ARRAY ['coins'::"text", 'gems'::"text"]))),
  CONSTRAINT "wallet_transactions_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
  CONSTRAINT "wallet_transactions_source_check" CHECK (("source" = ANY
                                                        (ARRAY ['admin_adjustment'::"text", 'match_reward'::"text", 'purchase'::"text", 'daily_bonus'::"text", 'level_reward'::"text", 'refund'::"text", 'system'::"text", 'entry_fee'::"text", 'wheel_spin'::"text", 'mission_reward'::"text", 'chest_reward'::"text", 'streak_chest_reward'::"text", 'mission_reroll_fee'::"text"])))
);


ALTER TABLE "public"."wallet_transactions"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wheel_configs"
(
  "id"               "text"                                   NOT NULL,
  "display_name"     "text"                                   NOT NULL,
  "cooldown_seconds" integer                  DEFAULT 3600    NOT NULL,
  "is_enabled"       boolean                  DEFAULT true    NOT NULL,
  "created_at"       timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at"       timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "wheel_configs_cooldown_seconds_check" CHECK ((("cooldown_seconds" >= 300) AND ("cooldown_seconds" <= 604800)))
);


ALTER TABLE "public"."wheel_configs"
  OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wheel_slots"
(
  "config_id"                 "text"                         NOT NULL,
  "slot_index"                integer                        NOT NULL,
  "primary_reward_type"       "text"                         NOT NULL,
  "primary_reward_amount"     integer                        NOT NULL,
  "primary_reward_icon_url"   "text",
  "secondary_reward_type"     "text",
  "secondary_reward_amount"   integer,
  "secondary_reward_icon_url" "text",
  "chance_basis_points"       integer                        NOT NULL,
  "label"                     "text",
  "accent_color"              "text"  DEFAULT 'gold'::"text" NOT NULL,
  "is_enabled"                boolean DEFAULT true           NOT NULL,
  CONSTRAINT "wheel_slots_chance_basis_points_check" CHECK ((("chance_basis_points" >= 0) AND ("chance_basis_points" <= 10000))),
  CONSTRAINT "wheel_slots_check" CHECK (((("secondary_reward_type" IS NULL) AND ("secondary_reward_amount" IS NULL)) OR
                                         (("secondary_reward_type" IS NOT NULL) AND
                                          ("secondary_reward_amount" IS NOT NULL)))),
  CONSTRAINT "wheel_slots_primary_reward_amount_check" CHECK (("primary_reward_amount" >= 0)),
  CONSTRAINT "wheel_slots_primary_reward_type_check" CHECK (("primary_reward_type" <> ''::"text")),
  CONSTRAINT "wheel_slots_secondary_reward_amount_check" CHECK ((("secondary_reward_amount" IS NULL) OR ("secondary_reward_amount" >= 0))),
  CONSTRAINT "wheel_slots_slot_index_check" CHECK ((("slot_index" >= 0) AND ("slot_index" <= 31)))
);


ALTER TABLE "public"."wheel_slots"
  OWNER TO "postgres";


ALTER TABLE ONLY "public"."billing_debug_log"
  ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."billing_debug_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."moves"
  ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."moves_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_email_allowlist"
  ADD CONSTRAINT "admin_email_allowlist_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."admin_roles"
  ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."billing_debug_log"
  ADD CONSTRAINT "billing_debug_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."board_theme_configs"
  ADD CONSTRAINT "board_theme_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chest_milestones"
  ADD CONSTRAINT "chest_milestones_milestone_index_key" UNIQUE ("milestone_index");



ALTER TABLE ONLY "public"."chest_milestones"
  ADD CONSTRAINT "chest_milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chest_rewards"
  ADD CONSTRAINT "chest_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."currencies"
  ADD CONSTRAINT "currencies_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."currency_configs"
  ADD CONSTRAINT "currency_configs_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."daily_bonus_configs"
  ADD CONSTRAINT "daily_bonus_configs_pkey" PRIMARY KEY ("day");



ALTER TABLE ONLY "public"."economy_grants"
  ADD CONSTRAINT "economy_grants_pkey" PRIMARY KEY ("trigger_key");



ALTER TABLE ONLY "public"."games"
  ADD CONSTRAINT "games_match_id_game_number_key" UNIQUE ("match_id", "game_number");



ALTER TABLE ONLY "public"."games"
  ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."level_configs"
  ADD CONSTRAINT "level_configs_pkey" PRIMARY KEY ("level");



ALTER TABLE ONLY "public"."level_status_tiers"
  ADD CONSTRAINT "level_status_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loading_screen_images"
  ADD CONSTRAINT "loading_screen_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lobby_feature_configs"
  ADD CONSTRAINT "lobby_feature_configs_feature_key_key" UNIQUE ("feature_key");



ALTER TABLE ONLY "public"."lobby_feature_configs"
  ADD CONSTRAINT "lobby_feature_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
  ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matchmaking_queue"
  ADD CONSTRAINT "matchmaking_queue_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."metric_distributions"
  ADD CONSTRAINT "metric_distributions_pkey" PRIMARY KEY ("metric_code", "percentile");



ALTER TABLE ONLY "public"."mission_progress_events"
  ADD CONSTRAINT "mission_progress_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."mission_rerolls"
  ADD CONSTRAINT "mission_rerolls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mission_rewards"
  ADD CONSTRAINT "mission_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mission_templates"
  ADD CONSTRAINT "mission_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mission_type_config"
  ADD CONSTRAINT "mission_type_config_pkey" PRIMARY KEY ("mission_type");



ALTER TABLE ONLY "public"."moves"
  ADD CONSTRAINT "moves_game_id_ply_key" UNIQUE ("game_id", "ply");



ALTER TABLE ONLY "public"."moves"
  ADD CONSTRAINT "moves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_daily_missions"
  ADD CONSTRAINT "player_daily_missions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_grants"
  ADD CONSTRAINT "player_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_metric_tiers"
  ADD CONSTRAINT "player_metric_tiers_pkey" PRIMARY KEY ("profile_id", "metric_code");



ALTER TABLE ONLY "public"."player_metrics"
  ADD CONSTRAINT "player_metrics_pkey" PRIMARY KEY ("profile_id", "metric_code");



ALTER TABLE ONLY "public"."player_mission_difficulty"
  ADD CONSTRAINT "player_mission_difficulty_pkey" PRIMARY KEY ("profile_id", "mission_type");



ALTER TABLE ONLY "public"."player_streak"
  ADD CONSTRAINT "player_streak_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."player_weekly_pass"
  ADD CONSTRAINT "player_weekly_pass_pkey" PRIMARY KEY ("profile_id", "week_key");



ALTER TABLE ONLY "public"."podium_images"
  ADD CONSTRAINT "podium_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
  ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
  ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reroll_pricing_config"
  ADD CONSTRAINT "reroll_pricing_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_items"
  ADD CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_config"
  ADD CONSTRAINT "store_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_sales"
  ADD CONSTRAINT "store_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streak_chest_rewards"
  ADD CONSTRAINT "streak_chest_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_configs"
  ADD CONSTRAINT "table_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_board_inventory"
  ADD CONSTRAINT "user_board_inventory_pkey" PRIMARY KEY ("profile_id", "board_theme_id");



ALTER TABLE ONLY "public"."user_daily_bonuses"
  ADD CONSTRAINT "user_daily_bonuses_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."user_inventory"
  ADD CONSTRAINT "user_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_inventory"
  ADD CONSTRAINT "user_inventory_profile_id_item_table_item_id_key" UNIQUE ("profile_id", "item_table", "item_id");



ALTER TABLE ONLY "public"."user_wallets"
  ADD CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."user_wheel_spins"
  ADD CONSTRAINT "user_wheel_spins_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."user_xp_boosts"
  ADD CONSTRAINT "user_xp_boosts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wheel_configs"
  ADD CONSTRAINT "wheel_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wheel_slots"
  ADD CONSTRAINT "wheel_slots_pkey" PRIMARY KEY ("config_id", "slot_index");



CREATE INDEX "admin_audit_log_entity_idx" ON "public"."admin_audit_log" USING "btree" ("entity_table", "entity_id", "created_at" DESC);



CREATE INDEX "admin_audit_log_recent_idx" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "board_theme_configs_enabled_sort_idx" ON "public"."board_theme_configs" USING "btree" ("is_enabled", "sort_order", "unlock_level");



CREATE INDEX "chest_rewards_milestone_idx" ON "public"."chest_rewards" USING "btree" ("milestone_id");



CREATE INDEX "games_match_id_idx" ON "public"."games" USING "btree" ("match_id");



CREATE INDEX "level_status_tiers_range_idx" ON "public"."level_status_tiers" USING "btree" ("level_from", "level_to") WHERE "is_enabled";



CREATE UNIQUE INDEX "loading_screen_images_one_active" ON "public"."loading_screen_images" USING "btree" ("is_active") WHERE "is_active";



CREATE INDEX "matches_active_public_idx" ON "public"."matches" USING "btree" ("started_at" DESC) WHERE (
  ("is_public" = true) AND ("opponent_id" IS NOT NULL) AND ("finished_at" IS NULL));



CREATE INDEX "matches_finished_at_idx" ON "public"."matches" USING "btree" ("finished_at");



CREATE UNIQUE INDEX "matches_invite_code_uniq" ON "public"."matches" USING "btree" ("invite_code") WHERE ("invite_code" IS NOT NULL);



CREATE INDEX "matches_open_public_idx" ON "public"."matches" USING "btree" ("started_at" DESC) WHERE (
  ("is_public" = true) AND ("opponent_id" IS NULL) AND ("finished_at" IS NULL));



CREATE INDEX "matches_opponent_id_idx" ON "public"."matches" USING "btree" ("opponent_id");



CREATE INDEX "matches_owner_id_idx" ON "public"."matches" USING "btree" ("owner_id");



CREATE INDEX "matches_table_config_id_idx" ON "public"."matches" USING "btree" ("table_config_id");



CREATE INDEX "matchmaking_queue_search_idx" ON "public"."matchmaking_queue" USING "btree" ("target", "rating") WHERE ("matched_match_id" IS NULL);



CREATE INDEX "matchmaking_queue_tier_search_idx" ON "public"."matchmaking_queue" USING "btree" ("table_config_id", "rating") WHERE ("matched_match_id" IS NULL);



CREATE INDEX "mission_progress_events_profile_idx" ON "public"."mission_progress_events" USING "btree" ("profile_id", "processed_at" DESC);



CREATE INDEX "mission_rerolls_profile_idx" ON "public"."mission_rerolls" USING "btree" ("profile_id", "rerolled_at" DESC);



CREATE INDEX "mission_rewards_mission_idx" ON "public"."mission_rewards" USING "btree" ("mission_id");



CREATE INDEX "mission_templates_pickable_idx" ON "public"."mission_templates" USING "btree" ("period", "enabled", "rarity");



CREATE INDEX "moves_game_id_idx" ON "public"."moves" USING "btree" ("game_id");



CREATE INDEX "player_daily_missions_profile_idx" ON "public"."player_daily_missions" USING "btree" ("profile_id", "expires_at" DESC);



CREATE INDEX "player_daily_missions_unclaimed_idx" ON "public"."player_daily_missions" USING "btree" ("profile_id", "completed_at") WHERE ("claimed_at" IS NULL);



CREATE INDEX "player_grants_profile_trigger_idx" ON "public"."player_grants" USING "btree" ("profile_id", "trigger_key");



CREATE INDEX "player_metric_tiers_tier_idx" ON "public"."player_metric_tiers" USING "btree" ("metric_code", "tier");



CREATE INDEX "player_metrics_metric_idx" ON "public"."player_metrics" USING "btree" ("metric_code");



CREATE INDEX "player_weekly_pass_week_idx" ON "public"."player_weekly_pass" USING "btree" ("week_key");



CREATE UNIQUE INDEX "podium_images_one_active" ON "public"."podium_images" USING "btree" ("is_active") WHERE "is_active";



CREATE INDEX "profiles_is_simulated_idx" ON "public"."profiles" USING "btree" ("is_simulated") WHERE ("is_simulated" = true);



CREATE INDEX "profiles_level_idx" ON "public"."profiles" USING "btree" ("level");



CREATE INDEX "profiles_rating_idx" ON "public"."profiles" USING "btree" ("rating" DESC);



CREATE INDEX "profiles_suspended_idx" ON "public"."profiles" USING "btree" ("is_suspended");



CREATE INDEX "purchases_profile_recent_idx" ON "public"."purchases" USING "btree" ("profile_id", "created_at" DESC);



CREATE UNIQUE INDEX "purchases_provider_txn_uniq" ON "public"."purchases" USING "btree" ("provider", "provider_transaction_id") WHERE ("provider_transaction_id" IS NOT NULL);



CREATE INDEX "shop_items_enabled_sort_idx" ON "public"."shop_items" USING "btree" ("is_enabled", "sort_order", "kind");



CREATE UNIQUE INDEX "shop_items_google_product_id_key" ON "public"."shop_items" USING "btree" ("google_product_id") WHERE ("google_product_id" IS NOT NULL);



CREATE INDEX "table_configs_enabled_sort_idx" ON "public"."table_configs" USING "btree" ("is_enabled", "sort_order", "required_level");



CREATE INDEX "table_configs_kind_sort_idx" ON "public"."table_configs" USING "btree" ("kind", "is_enabled", "sort_order");



CREATE INDEX "user_board_inventory_board_idx" ON "public"."user_board_inventory" USING "btree" ("board_theme_id");



CREATE INDEX "user_inventory_profile_idx" ON "public"."user_inventory" USING "btree" ("profile_id");



CREATE INDEX "user_xp_boosts_profile_expires_idx" ON "public"."user_xp_boosts" USING "btree" ("profile_id", "expires_at" DESC);



CREATE INDEX "wallet_transactions_profile_recent_idx" ON "public"."wallet_transactions" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "wheel_slots_config_idx" ON "public"."wheel_slots" USING "btree" ("config_id", "slot_index");



CREATE OR REPLACE TRIGGER "admin_email_allowlist_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."admin_email_allowlist"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "admin_email_allowlist_updated_at"
  BEFORE UPDATE
  ON "public"."admin_email_allowlist"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "admin_roles_updated_at"
  BEFORE UPDATE
  ON "public"."admin_roles"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "board_theme_configs_updated_at"
  BEFORE UPDATE
  ON "public"."board_theme_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "chest_milestones_updated_at"
  BEFORE UPDATE
  ON "public"."chest_milestones"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "currencies_updated_at"
  BEFORE UPDATE
  ON "public"."currencies"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "currency_configs_updated_at"
  BEFORE UPDATE
  ON "public"."currency_configs"
  FOR EACH ROW
EXECUTE FUNCTION "private"."touch_currency_configs_updated_at"();



CREATE OR REPLACE TRIGGER "daily_bonus_configs_updated_at"
  BEFORE UPDATE
  ON "public"."daily_bonus_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "economy_grants_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."economy_grants"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "economy_grants_updated_at"
  BEFORE UPDATE
  ON "public"."economy_grants"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "level_configs_updated_at"
  BEFORE UPDATE
  ON "public"."level_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "level_status_tiers_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."level_status_tiers"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "level_status_tiers_updated_at"
  BEFORE UPDATE
  ON "public"."level_status_tiers"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "loading_screen_images_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."loading_screen_images"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "loading_screen_images_updated_at"
  BEFORE UPDATE
  ON "public"."loading_screen_images"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "lobby_feature_configs_updated_at"
  BEFORE UPDATE
  ON "public"."lobby_feature_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "matches_progress_missions_trg"
  AFTER UPDATE OF "finished_at"
  ON "public"."matches"
  FOR EACH ROW
EXECUTE FUNCTION "public"."matches_progress_missions"();



CREATE OR REPLACE TRIGGER "matches_rating_update"
  AFTER UPDATE OF "finished_at"
  ON "public"."matches"
  FOR EACH ROW
  WHEN ((("new"."finished_at" IS NOT NULL) AND ("old"."finished_at" IS NULL)))
EXECUTE FUNCTION "public"."update_rating_on_match_finish"();



CREATE OR REPLACE TRIGGER "matches_updated_at"
  BEFORE UPDATE
  ON "public"."matches"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "mission_templates_updated_at"
  BEFORE UPDATE
  ON "public"."mission_templates"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "mission_type_config_updated_at"
  BEFORE UPDATE
  ON "public"."mission_type_config"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "moves_bump_match_activity"
  AFTER INSERT
  ON "public"."moves"
  FOR EACH ROW
EXECUTE FUNCTION "public"."bump_match_activity_on_move"();



CREATE OR REPLACE TRIGGER "player_daily_missions_personalized_guard"
  BEFORE INSERT OR UPDATE
  ON "public"."player_daily_missions"
  FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_personalized_mission_fields"();



CREATE OR REPLACE TRIGGER "player_streak_updated_at"
  BEFORE UPDATE
  ON "public"."player_streak"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "player_weekly_pass_updated_at"
  BEFORE UPDATE
  ON "public"."player_weekly_pass"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "podium_images_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."podium_images"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "podium_images_updated_at"
  BEFORE UPDATE
  ON "public"."podium_images"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_auto_promote_level"
  BEFORE UPDATE OF "xp"
  ON "public"."profiles"
  FOR EACH ROW
  WHEN (("new"."xp" IS DISTINCT FROM "old"."xp"))
EXECUTE FUNCTION "public"."profiles_auto_promote_level"();



CREATE OR REPLACE TRIGGER "profiles_create_daily_bonus"
  AFTER INSERT
  ON "public"."profiles"
  FOR EACH ROW
EXECUTE FUNCTION "private"."ensure_user_daily_bonus"();



CREATE OR REPLACE TRIGGER "profiles_create_wallet"
  AFTER INSERT
  ON "public"."profiles"
  FOR EACH ROW
EXECUTE FUNCTION "private"."ensure_user_wallet"();



CREATE OR REPLACE TRIGGER "profiles_progress_level_missions_trg"
  AFTER UPDATE OF "level"
  ON "public"."profiles"
  FOR EACH ROW
EXECUTE FUNCTION "public"."profiles_progress_level_missions"();



CREATE OR REPLACE TRIGGER "profiles_progress_xp_missions_trg"
  AFTER UPDATE OF "xp"
  ON "public"."profiles"
  FOR EACH ROW
EXECUTE FUNCTION "public"."profiles_progress_xp_missions"();



CREATE OR REPLACE TRIGGER "profiles_updated_at"
  BEFORE UPDATE
  ON "public"."profiles"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reroll_pricing_config_updated_at"
  BEFORE UPDATE
  ON "public"."reroll_pricing_config"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "shop_items_audit_log"
  AFTER INSERT OR DELETE OR UPDATE
  ON "public"."shop_items"
  FOR EACH ROW
EXECUTE FUNCTION "private"."log_admin_config_change"();



CREATE OR REPLACE TRIGGER "shop_items_updated_at"
  BEFORE UPDATE
  ON "public"."shop_items"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "table_configs_updated_at"
  BEFORE UPDATE
  ON "public"."table_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_store_config_set_updated_at"
  BEFORE UPDATE
  ON "public"."store_config"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_store_sales_set_updated_at"
  BEFORE UPDATE
  ON "public"."store_sales"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_daily_bonuses_updated_at"
  BEFORE UPDATE
  ON "public"."user_daily_bonuses"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_wallets_updated_at"
  BEFORE UPDATE
  ON "public"."user_wallets"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "wallet_transactions_progress_missions_trg"
  AFTER INSERT
  ON "public"."wallet_transactions"
  FOR EACH ROW
EXECUTE FUNCTION "public"."wallet_transactions_progress_missions"();



CREATE OR REPLACE TRIGGER "wheel_configs_updated_at"
  BEFORE UPDATE
  ON "public"."wheel_configs"
  FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_email_allowlist"
  ADD CONSTRAINT "admin_email_allowlist_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_roles"
  ADD CONSTRAINT "admin_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_roles"
  ADD CONSTRAINT "admin_roles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."board_theme_configs"
  ADD CONSTRAINT "board_theme_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chest_rewards"
  ADD CONSTRAINT "chest_rewards_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies" ("code");



ALTER TABLE ONLY "public"."chest_rewards"
  ADD CONSTRAINT "chest_rewards_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."chest_milestones" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."currency_configs"
  ADD CONSTRAINT "currency_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_bonus_configs"
  ADD CONSTRAINT "daily_bonus_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."economy_grants"
  ADD CONSTRAINT "economy_grants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."games"
  ADD CONSTRAINT "games_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."level_configs"
  ADD CONSTRAINT "level_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."level_status_tiers"
  ADD CONSTRAINT "level_status_tiers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loading_screen_images"
  ADD CONSTRAINT "loading_screen_images_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."matches"
  ADD CONSTRAINT "matches_current_game_id_fkey" FOREIGN KEY ("current_game_id") REFERENCES "public"."games" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."matches"
  ADD CONSTRAINT "matches_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."profiles" ("id");



ALTER TABLE ONLY "public"."matches"
  ADD CONSTRAINT "matches_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matches"
  ADD CONSTRAINT "matches_table_config_id_fkey" FOREIGN KEY ("table_config_id") REFERENCES "public"."table_configs" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."matchmaking_queue"
  ADD CONSTRAINT "matchmaking_queue_matched_match_id_fkey" FOREIGN KEY ("matched_match_id") REFERENCES "public"."matches" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."matchmaking_queue"
  ADD CONSTRAINT "matchmaking_queue_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matchmaking_queue"
  ADD CONSTRAINT "matchmaking_queue_table_config_id_fkey" FOREIGN KEY ("table_config_id") REFERENCES "public"."table_configs" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mission_rerolls"
  ADD CONSTRAINT "mission_rerolls_new_template_id_fkey" FOREIGN KEY ("new_template_id") REFERENCES "public"."mission_templates" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mission_rerolls"
  ADD CONSTRAINT "mission_rerolls_prior_template_id_fkey" FOREIGN KEY ("prior_template_id") REFERENCES "public"."mission_templates" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mission_rerolls"
  ADD CONSTRAINT "mission_rerolls_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mission_rewards"
  ADD CONSTRAINT "mission_rewards_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies" ("code");



ALTER TABLE ONLY "public"."mission_rewards"
  ADD CONSTRAINT "mission_rewards_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."mission_templates" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moves"
  ADD CONSTRAINT "moves_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_daily_missions"
  ADD CONSTRAINT "player_daily_missions_mission_template_id_fkey" FOREIGN KEY ("mission_template_id") REFERENCES "public"."mission_templates" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_daily_missions"
  ADD CONSTRAINT "player_daily_missions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_grants"
  ADD CONSTRAINT "player_grants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_grants"
  ADD CONSTRAINT "player_grants_trigger_key_fkey" FOREIGN KEY ("trigger_key") REFERENCES "public"."economy_grants" ("trigger_key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_metric_tiers"
  ADD CONSTRAINT "player_metric_tiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_metrics"
  ADD CONSTRAINT "player_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_mission_difficulty"
  ADD CONSTRAINT "player_mission_difficulty_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_streak"
  ADD CONSTRAINT "player_streak_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_weekly_pass"
  ADD CONSTRAINT "player_weekly_pass_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."podium_images"
  ADD CONSTRAINT "podium_images_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
  ADD CONSTRAINT "purchases_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_items"
  ADD CONSTRAINT "shop_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."streak_chest_rewards"
  ADD CONSTRAINT "streak_chest_rewards_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies" ("code");



ALTER TABLE ONLY "public"."table_configs"
  ADD CONSTRAINT "table_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_board_inventory"
  ADD CONSTRAINT "user_board_inventory_board_theme_id_fkey" FOREIGN KEY ("board_theme_id") REFERENCES "public"."board_theme_configs" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_board_inventory"
  ADD CONSTRAINT "user_board_inventory_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_board_inventory"
  ADD CONSTRAINT "user_board_inventory_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_daily_bonuses"
  ADD CONSTRAINT "user_daily_bonuses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_inventory"
  ADD CONSTRAINT "user_inventory_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_wallets"
  ADD CONSTRAINT "user_wallets_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_wheel_spins"
  ADD CONSTRAINT "user_wheel_spins_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "public"."wheel_configs" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_wheel_spins"
  ADD CONSTRAINT "user_wheel_spins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_xp_boosts"
  ADD CONSTRAINT "user_xp_boosts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_xp_boosts"
  ADD CONSTRAINT "user_xp_boosts_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "public"."shop_items" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles" ("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles" ("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wheel_slots"
  ADD CONSTRAINT "wheel_slots_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "public"."wheel_configs" ("id") ON DELETE CASCADE;



ALTER TABLE "public"."admin_audit_log"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_log_insert_admin" ON "public"."admin_audit_log" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "admin_audit_log_select_admin" ON "public"."admin_audit_log" FOR SELECT USING ("private"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."admin_email_allowlist"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_email_allowlist_delete_admin" ON "public"."admin_email_allowlist" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "admin_email_allowlist_insert_admin" ON "public"."admin_email_allowlist" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "admin_email_allowlist_select_self_or_admin" ON "public"."admin_email_allowlist" FOR SELECT USING ((
  ("email" = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))) OR
  "private"."is_admin"("auth"."uid"())));



CREATE POLICY "admin_email_allowlist_update_admin" ON "public"."admin_email_allowlist" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."admin_roles"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_roles_delete_by_owner_admin" ON "public"."admin_roles" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "admin_roles_insert_by_owner_admin" ON "public"."admin_roles" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "admin_roles_select_self_or_admin" ON "public"."admin_roles" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



CREATE POLICY "admin_roles_update_by_owner_admin" ON "public"."admin_roles" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."billing_debug_log"
  ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."board_theme_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "board_theme_configs_delete_admin" ON "public"."board_theme_configs" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "board_theme_configs_insert_admin" ON "public"."board_theme_configs" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "board_theme_configs_read_all" ON "public"."board_theme_configs" FOR SELECT USING (true);



CREATE POLICY "board_theme_configs_update_admin" ON "public"."board_theme_configs" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."chest_milestones"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chest_milestones_admin_write" ON "public"."chest_milestones" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "chest_milestones_read" ON "public"."chest_milestones" FOR SELECT USING (true);



ALTER TABLE "public"."chest_rewards"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chest_rewards_admin_write" ON "public"."chest_rewards" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "chest_rewards_read" ON "public"."chest_rewards" FOR SELECT USING (true);



ALTER TABLE "public"."currencies"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "currencies_admin_write" ON "public"."currencies" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "currencies_read" ON "public"."currencies" FOR SELECT USING (true);



ALTER TABLE "public"."currency_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "currency_configs_read_all" ON "public"."currency_configs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."daily_bonus_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_bonus_configs_select_all" ON "public"."daily_bonus_configs" FOR SELECT USING (true);



CREATE POLICY "daily_bonus_configs_write_admin" ON "public"."daily_bonus_configs" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."economy_grants"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "economy_grants_read_all" ON "public"."economy_grants" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."games"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "games_insert_via_match" ON "public"."games" FOR INSERT WITH CHECK (("match_id" IN (SELECT "m"."id"
                                                                                                  FROM "public"."matches" "m"
                                                                                                  WHERE ((("m"."owner_id" = "auth"."uid"()) OR
                                                                                                          ("m"."opponent_id" = "auth"."uid"())) AND
                                                                                                         ("m"."mode" <> 'online'::"text")))));



CREATE POLICY "games_read_via_match" ON "public"."games" FOR SELECT USING (("match_id" IN (SELECT "matches"."id"
                                                                                           FROM "public"."matches"
                                                                                           WHERE (("matches"."finished_at" IS NOT NULL) OR
                                                                                                  ("matches"."owner_id" = "auth"."uid"()) OR
                                                                                                  ("matches"."opponent_id" = "auth"."uid"()) OR
                                                                                                  (("matches"."mode" = 'online'::"text") AND
                                                                                                   ("matches"."is_public" = true))))));



CREATE POLICY "games_update_via_match" ON "public"."games" FOR UPDATE USING (("match_id" IN (SELECT "m"."id"
                                                                                             FROM "public"."matches" "m"
                                                                                             WHERE ((("m"."owner_id" = "auth"."uid"()) OR
                                                                                                     ("m"."opponent_id" = "auth"."uid"())) AND
                                                                                                    ("m"."mode" <> 'online'::"text")))));



ALTER TABLE "public"."level_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "level_configs_delete_admin" ON "public"."level_configs" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "level_configs_insert_admin" ON "public"."level_configs" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "level_configs_read_all" ON "public"."level_configs" FOR SELECT USING (true);



CREATE POLICY "level_configs_update_admin" ON "public"."level_configs" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."level_status_tiers"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "level_status_tiers_delete_admin" ON "public"."level_status_tiers" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "level_status_tiers_insert_admin" ON "public"."level_status_tiers" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "level_status_tiers_read_all" ON "public"."level_status_tiers" FOR SELECT USING (true);



CREATE POLICY "level_status_tiers_update_admin" ON "public"."level_status_tiers" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."loading_screen_images"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loading_screen_images_delete_admin" ON "public"."loading_screen_images" FOR DELETE TO "authenticated" USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "loading_screen_images_insert_admin" ON "public"."loading_screen_images" FOR INSERT TO "authenticated" WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "loading_screen_images_read_all" ON "public"."loading_screen_images" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "loading_screen_images_update_admin" ON "public"."loading_screen_images" FOR UPDATE TO "authenticated" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."lobby_feature_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lobby_feature_configs_delete_admin" ON "public"."lobby_feature_configs" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "lobby_feature_configs_insert_admin" ON "public"."lobby_feature_configs" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "lobby_feature_configs_read_all" ON "public"."lobby_feature_configs" FOR SELECT USING (true);



CREATE POLICY "lobby_feature_configs_update_admin" ON "public"."lobby_feature_configs" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."matches"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "matches_insert_own" ON "public"."matches" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "matches_read" ON "public"."matches" FOR SELECT USING ((("finished_at" IS NOT NULL) OR
                                                                      ("owner_id" = "auth"."uid"()) OR
                                                                      ("opponent_id" = "auth"."uid"()) OR
                                                                      (("mode" = 'online'::"text") AND ("is_public" = true)) OR
                                                                      (("mode" = 'online'::"text") AND
                                                                       ("opponent_id" IS NULL) AND
                                                                       ("invite_code" IS NOT NULL) AND
                                                                       (("invite_expires_at" IS NULL) OR ("invite_expires_at" > "now"())))));



CREATE POLICY "matches_update_own_or_opponent" ON "public"."matches" FOR UPDATE USING ((("owner_id" = "auth"."uid"()) OR ("opponent_id" = "auth"."uid"())));



ALTER TABLE "public"."matchmaking_queue"
  ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."metric_distributions"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "metric_distributions_admin_write" ON "public"."metric_distributions" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "metric_distributions_read" ON "public"."metric_distributions" FOR SELECT USING ("private"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."mission_progress_events"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mission_progress_events_admin_read" ON "public"."mission_progress_events" FOR SELECT USING ("private"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."mission_rerolls"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mission_rerolls_own_read" ON "public"."mission_rerolls" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."mission_rewards"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mission_rewards_admin_write" ON "public"."mission_rewards" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "mission_rewards_read" ON "public"."mission_rewards" FOR SELECT USING (true);



ALTER TABLE "public"."mission_templates"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mission_templates_admin_write" ON "public"."mission_templates" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "mission_templates_read" ON "public"."mission_templates" FOR SELECT USING (true);



ALTER TABLE "public"."mission_type_config"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mission_type_config_read" ON "public"."mission_type_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "mission_type_config_write" ON "public"."mission_type_config" TO "authenticated" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."moves"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "moves_insert_via_game" ON "public"."moves" FOR INSERT WITH CHECK (("game_id" IN (SELECT "g"."id"
                                                                                                FROM ("public"."games" "g"
                                                                                                  JOIN "public"."matches" "m"
                                                                                                      ON (("g"."match_id" = "m"."id")))
                                                                                                WHERE ((("m"."owner_id" = "auth"."uid"()) OR
                                                                                                        ("m"."opponent_id" = "auth"."uid"())) AND
                                                                                                       ("m"."mode" <> 'online'::"text")))));



CREATE POLICY "moves_read_via_game" ON "public"."moves" FOR SELECT USING (("game_id" IN (SELECT "g"."id"
                                                                                         FROM ("public"."games" "g"
                                                                                           JOIN "public"."matches" "m"
                                                                                               ON (("g"."match_id" = "m"."id")))
                                                                                         WHERE (("m"."finished_at" IS NOT NULL) OR
                                                                                                ("m"."owner_id" = "auth"."uid"()) OR
                                                                                                ("m"."opponent_id" = "auth"."uid"()) OR
                                                                                                (("m"."mode" = 'online'::"text") AND ("m"."is_public" = true))))));



ALTER TABLE "public"."player_daily_missions"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_daily_missions_own_read" ON "public"."player_daily_missions" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."player_grants"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_grants_select_own_or_admin" ON "public"."player_grants" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."player_metric_tiers"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_metric_tiers_own_read" ON "public"."player_metric_tiers" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."player_metrics"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_metrics_own_read" ON "public"."player_metrics" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."player_mission_difficulty"
  ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_streak"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_streak_own_read" ON "public"."player_streak" FOR SELECT USING ((("profile_id" = "auth"."uid"()) OR
                                                                                      "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."player_weekly_pass"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_weekly_pass_own_read" ON "public"."player_weekly_pass" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."podium_images"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "podium_images_delete_admin" ON "public"."podium_images" FOR DELETE TO "authenticated" USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "podium_images_insert_admin" ON "public"."podium_images" FOR INSERT TO "authenticated" WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "podium_images_read_all" ON "public"."podium_images" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "podium_images_update_admin" ON "public"."podium_images" FOR UPDATE TO "authenticated" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_read_all" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "profiles_update_admin" ON "public"."profiles" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."purchases"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchases_insert_admin" ON "public"."purchases" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "purchases_select_own_or_admin" ON "public"."purchases" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



CREATE POLICY "queue_delete_own" ON "public"."matchmaking_queue" FOR DELETE USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "queue_read_own" ON "public"."matchmaking_queue" FOR SELECT USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "reroll_pricing_admin_write" ON "public"."reroll_pricing_config" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."reroll_pricing_config"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reroll_pricing_read" ON "public"."reroll_pricing_config" FOR SELECT USING (true);



ALTER TABLE "public"."shop_items"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_items_delete_admin" ON "public"."shop_items" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "shop_items_insert_admin" ON "public"."shop_items" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "shop_items_read_all" ON "public"."shop_items" FOR SELECT USING (true);



CREATE POLICY "shop_items_update_admin" ON "public"."shop_items" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."store_config"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store_config_select_all" ON "public"."store_config" FOR SELECT USING (true);



CREATE POLICY "store_config_write_config" ON "public"."store_config" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."store_sales"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store_sales_select_all" ON "public"."store_sales" FOR SELECT USING (true);



CREATE POLICY "store_sales_write_config" ON "public"."store_sales" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."streak_chest_rewards"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "streak_chest_rewards_admin_write" ON "public"."streak_chest_rewards" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "streak_chest_rewards_read" ON "public"."streak_chest_rewards" FOR SELECT USING (true);



ALTER TABLE "public"."table_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "table_configs_delete_admin" ON "public"."table_configs" FOR DELETE USING ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "table_configs_insert_admin" ON "public"."table_configs" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "table_configs_read_all" ON "public"."table_configs" FOR SELECT USING (true);



CREATE POLICY "table_configs_update_admin" ON "public"."table_configs" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."user_board_inventory"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_board_inventory_select_own_or_admin" ON "public"."user_board_inventory" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



CREATE POLICY "user_board_inventory_write_admin" ON "public"."user_board_inventory" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."user_daily_bonuses"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_daily_bonuses_select_own_or_admin" ON "public"."user_daily_bonuses" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



CREATE POLICY "user_daily_bonuses_write_admin" ON "public"."user_daily_bonuses" USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."user_inventory"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_inventory_own_read" ON "public"."user_inventory" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."user_wallets"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_wallets_insert_admin" ON "public"."user_wallets" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "user_wallets_select_own_or_admin" ON "public"."user_wallets" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



CREATE POLICY "user_wallets_update_admin" ON "public"."user_wallets" FOR UPDATE USING ("private"."can_manage_config"("auth"."uid"())) WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



ALTER TABLE "public"."user_wheel_spins"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_wheel_spins_own_read" ON "public"."user_wheel_spins" FOR SELECT USING (("profile_id" = "auth"."uid"()));



ALTER TABLE "public"."user_xp_boosts"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_xp_boosts_self_read" ON "public"."user_xp_boosts" FOR SELECT USING (("profile_id" = "auth"."uid"()));



ALTER TABLE "public"."wallet_transactions"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_transactions_insert_admin" ON "public"."wallet_transactions" FOR INSERT WITH CHECK ("private"."can_manage_config"("auth"."uid"()));



CREATE POLICY "wallet_transactions_select_own_or_admin" ON "public"."wallet_transactions" FOR SELECT USING ((
  ("profile_id" = "auth"."uid"()) OR "private"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."wheel_configs"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wheel_configs_admin_write" ON "public"."wheel_configs" USING ("private"."is_admin"("auth"."uid"())) WITH CHECK ("private"."is_admin"("auth"."uid"()));



CREATE POLICY "wheel_configs_read" ON "public"."wheel_configs" FOR SELECT USING (true);



ALTER TABLE "public"."wheel_slots"
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wheel_slots_admin_write" ON "public"."wheel_slots" USING ("private"."is_admin"("auth"."uid"())) WITH CHECK ("private"."is_admin"("auth"."uid"()));



CREATE POLICY "wheel_slots_read" ON "public"."wheel_slots" FOR SELECT USING (true);



GRANT USAGE ON SCHEMA "private" TO "anon";
GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."shop_items" TO "anon";
GRANT ALL ON TABLE "public"."shop_items" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_items" TO "service_role";



GRANT ALL ON TABLE "public"."user_wallets" TO "anon";
GRANT ALL ON TABLE "public"."user_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_wallets" TO "service_role";



REVOKE ALL ON FUNCTION "private"."apply_shop_grants_and_record"("p_profile_id" "uuid", "p_item" "public"."shop_items", "p_provider" "text", "p_txn" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."assert_shop_item_purchasable"("p_profile_id" "uuid", "p_item" "public"."shop_items") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."can_manage_config"("check_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_config"("check_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "private"."can_manage_config"("check_profile_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."current_admin_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_admin_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."effective_store_sale_bonus"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."is_admin"("check_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_admin"("check_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "private"."is_admin"("check_profile_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."abandon_stale_matches"("p_max_age_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_adjust_wallet"("target_profile_id" "uuid", "currency_code" "text", "delta_amount" integer, "adjustment_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_adjust_wallet"("target_profile_id" "uuid", "currency_code" "text", "delta_amount" integer, "adjustment_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_wallet"("target_profile_id" "uuid", "currency_code" "text", "delta_amount" integer, "adjustment_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_hard_delete_user"("target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_refresh_player_missions"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_refresh_player_missions"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_refresh_player_missions"("p_email" "text") TO "service_role";



GRANT ALL ON TABLE "public"."currency_configs" TO "anon";
GRANT ALL ON TABLE "public"."currency_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."currency_configs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text", "p_usd_value_micros" bigint, "p_is_enabled" boolean, "p_sort_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text", "p_usd_value_micros" bigint, "p_is_enabled" boolean, "p_sort_order" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_currency_config"("p_code" "text", "p_display_name" "text", "p_usd_value_micros" bigint, "p_is_enabled" boolean, "p_sort_order" integer) TO "service_role";



GRANT ALL ON TABLE "public"."economy_grants" TO "anon";
GRANT ALL ON TABLE "public"."economy_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."economy_grants" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text", "p_description" "text", "p_coins" integer, "p_gems" integer, "p_one_time" boolean, "p_is_enabled" boolean, "p_sort_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text", "p_description" "text", "p_coins" integer, "p_gems" integer, "p_one_time" boolean, "p_is_enabled" boolean, "p_sort_order" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_economy_grant"("p_trigger_key" "text", "p_display_name" "text", "p_description" "text", "p_coins" integer, "p_gems" integer, "p_one_time" boolean, "p_is_enabled" boolean, "p_sort_order" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_economy_grant"("p_profile_id" "uuid", "p_trigger_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_economy_grant"("p_profile_id" "uuid", "p_trigger_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_daily_missions_for_all"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_daily_missions_for_all"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_daily_missions_for_profile"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_match_activity_on_move"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_match_activity_on_move"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_match_activity_on_move"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_matchmaking"() TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_matchmaking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_matchmaking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_chest"("p_milestone_index" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_chest"("p_milestone_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_chest"("p_milestone_index" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_daily_bonus"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_daily_bonus"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_daily_bonus"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_mission"("p_mission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_mission"("p_mission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_mission"("p_mission_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_streak_chest"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_streak_chest"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_streak_chest"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_stale_rows"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_stale_rows"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_ai_turn"("p_match_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_ai_turn"("p_match_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_turn_server"("p_match_id" "uuid", "p_caller_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_turn_server"("p_match_id" "uuid", "p_caller_id" "uuid", "p_dice" integer[], "p_sub_moves" "jsonb", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_store_sale"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_store_sale"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_store_sale"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_xp_multiplier"("target_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."daily_streak_rollover"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."daily_streak_rollover"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_personalized_mission_fields"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_personalized_mission_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text", "p_match_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text", "p_match_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enter_room"("p_table_config_id" "text", "p_match_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enter_room_ai_fallback"("p_table_config_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_match_in_tier"("p_table_config_id" "text", "p_rating_band" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer, "p_black_score" integer, "p_winner" "text", "p_crawford_game_number" integer, "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer, "p_black_score" integer, "p_winner" "text", "p_crawford_game_number" integer, "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finish_match"("p_match_id" "uuid", "p_white_score" integer, "p_black_score" integer, "p_winner" "text", "p_crawford_game_number" integer, "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finish_turn"("p_match_id" "uuid", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finish_turn"("p_match_id" "uuid", "p_game_winner" "text", "p_game_win_type" "text", "p_game_points" integer, "p_game_dropped_double" boolean, "p_new_white_score" integer, "p_new_black_score" integer, "p_match_winner" "text", "p_crawford_game_number" integer, "p_elapsed_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fulfill_google_purchase"("p_profile_id" "uuid", "p_item_id" "text", "p_purchase_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fulfill_google_purchase"("p_profile_id" "uuid", "p_item_id" "text", "p_purchase_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_admin_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_admin_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_admin_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_admin_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_player_lobby_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_player_lobby_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_player_lobby_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_player_missions_today"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_player_missions_today"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_player_missions_today"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text", "p_since" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text", "p_since" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rtp_per_player"("p_table_config_id" "text", "p_since" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rtp_summary"("p_since" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_wheel_state"("p_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_wheel_state"("p_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_wheel_state"("p_config_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_match_reward"("p_match_id" "uuid", "p_winner" "text", "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_match_reward"("p_match_id" "uuid", "p_winner" "text", "p_owner_abandoned" boolean, "p_opponent_abandoned" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."join_match_by_invite"("invite" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_match_by_invite"("invite" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_match_by_invite"("invite" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_public_match"("target_match_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."join_public_match"("target_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_public_match"("target_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_tutorial_complete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_tutorial_complete"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tutorial_complete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tutorial_complete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."matches_progress_missions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."matches_progress_missions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."matchmake"("p_target" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."matchmake"("p_target" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."matchmake"("p_target" integer) TO "service_role";



GRANT ALL ON TABLE "public"."player_daily_missions" TO "anon";
GRANT ALL ON TABLE "public"."player_daily_missions" TO "authenticated";
GRANT ALL ON TABLE "public"."player_daily_missions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."mp_assign_personalized"("p_profile_id" "uuid", "p_mission_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mp_assign_personalized"("p_profile_id" "uuid", "p_mission_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mp_assign_play_matches"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mp_assign_play_matches"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."mission_templates" TO "anon";
GRANT ALL ON TABLE "public"."mission_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_templates" TO "service_role";



GRANT ALL ON FUNCTION "public"."mp_cashback_reward"("t" "public"."mission_templates", "p_goal" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."mp_cashback_reward"("t" "public"."mission_templates", "p_goal" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mp_cashback_reward"("t" "public"."mission_templates", "p_goal" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mp_play_matches_preview"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mp_play_matches_preview"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mp_render_mission_text"("p_text" "text", "p_goal" integer, "p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."profiles_auto_promote_level"() TO "anon";
GRANT ALL ON FUNCTION "public"."profiles_auto_promote_level"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiles_auto_promote_level"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiles_progress_level_missions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiles_progress_level_missions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiles_progress_xp_missions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiles_progress_xp_missions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."progress_mission"("p_profile_id" "uuid", "p_metric_code" "text", "p_delta" integer, "p_event_id" "text", "p_context" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."progress_mission"("p_profile_id" "uuid", "p_metric_code" "text", "p_delta" integer, "p_event_id" "text", "p_context" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."progress_mission_reset"("p_profile_id" "uuid", "p_metric_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."progress_mission_reset"("p_profile_id" "uuid", "p_metric_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_board_with_gems"("target_board_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_shop_item"("target_item_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_shop_item"("target_item_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_shop_item"("target_item_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_daily_mission_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_daily_mission_metrics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_player_levels"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_player_levels"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_player_levels"() TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_opponent_with_ai"("p_match_id" "uuid", "p_min_inactive_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."replace_opponent_with_ai"("p_match_id" "uuid", "p_min_inactive_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_opponent_with_ai"("p_match_id" "uuid", "p_min_inactive_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reroll_mission"("p_mission_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_active_loading_screen"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_active_loading_screen"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_active_loading_screen"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_active_podium"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_active_podium"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_active_podium"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_cleanup_all"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_cleanup_all"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_cleanup_all"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_create_test_profile"("p_display_name" "text", "p_level" integer, "p_pvp_rating" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_create_test_profile"("p_display_name" "text", "p_level" integer, "p_pvp_rating" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_create_test_profile"("p_display_name" "text", "p_level" integer, "p_pvp_rating" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_get_test_user_state"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_get_test_user_state"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_get_test_user_state"("p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_list_test_profiles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_list_test_profiles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_list_test_profiles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_reset_today_missions"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_reset_today_missions"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_reset_today_missions"("p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_set_metric"("p_profile_id" "uuid", "p_metric_code" "text", "p_baseline" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_set_metric"("p_profile_id" "uuid", "p_metric_code" "text", "p_baseline" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_set_metric"("p_profile_id" "uuid", "p_metric_code" "text", "p_baseline" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."simulate_spawn_archetypes"("p_casuals" integer, "p_regulars" integer, "p_whales" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."simulate_spawn_archetypes"("p_casuals" integer, "p_regulars" integer, "p_whales" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."simulate_spawn_archetypes"("p_casuals" integer, "p_regulars" integer, "p_whales" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."spin_wheel"("p_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."spin_wheel"("p_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."spin_wheel"("p_config_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_purchase_shop_item"("p_item_id" "text", "p_target_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_rating_on_match_finish"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_rating_on_match_finish"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_rating_on_match_finish"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."wallet_transactions_progress_missions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."wallet_transactions_progress_missions"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."admin_email_allowlist" TO "anon";
GRANT ALL ON TABLE "public"."admin_email_allowlist" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_email_allowlist" TO "service_role";



GRANT ALL ON TABLE "public"."admin_roles" TO "anon";
GRANT ALL ON TABLE "public"."admin_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";



GRANT ALL ON TABLE "public"."billing_debug_log" TO "anon";
GRANT ALL ON TABLE "public"."billing_debug_log" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_debug_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."billing_debug_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."billing_debug_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."billing_debug_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."board_theme_configs" TO "anon";
GRANT ALL ON TABLE "public"."board_theme_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."board_theme_configs" TO "service_role";



GRANT ALL ON TABLE "public"."chest_milestones" TO "anon";
GRANT ALL ON TABLE "public"."chest_milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."chest_milestones" TO "service_role";



GRANT ALL ON TABLE "public"."chest_rewards" TO "anon";
GRANT ALL ON TABLE "public"."chest_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."chest_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."currencies" TO "anon";
GRANT ALL ON TABLE "public"."currencies" TO "authenticated";
GRANT ALL ON TABLE "public"."currencies" TO "service_role";



GRANT ALL ON TABLE "public"."daily_bonus_configs" TO "anon";
GRANT ALL ON TABLE "public"."daily_bonus_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_bonus_configs" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."level_configs" TO "anon";
GRANT ALL ON TABLE "public"."level_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."level_configs" TO "service_role";



GRANT ALL ON TABLE "public"."level_status_tiers" TO "anon";
GRANT ALL ON TABLE "public"."level_status_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."level_status_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."loading_screen_images" TO "anon";
GRANT ALL ON TABLE "public"."loading_screen_images" TO "authenticated";
GRANT ALL ON TABLE "public"."loading_screen_images" TO "service_role";



GRANT ALL ON TABLE "public"."lobby_feature_configs" TO "anon";
GRANT ALL ON TABLE "public"."lobby_feature_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."lobby_feature_configs" TO "service_role";



GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



GRANT ALL ON TABLE "public"."matchmaking_queue" TO "anon";
GRANT ALL ON TABLE "public"."matchmaking_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."matchmaking_queue" TO "service_role";



GRANT ALL ON TABLE "public"."metric_distributions" TO "anon";
GRANT ALL ON TABLE "public"."metric_distributions" TO "authenticated";
GRANT ALL ON TABLE "public"."metric_distributions" TO "service_role";



GRANT ALL ON TABLE "public"."mission_progress_events" TO "anon";
GRANT ALL ON TABLE "public"."mission_progress_events" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_progress_events" TO "service_role";



GRANT ALL ON TABLE "public"."mission_rerolls" TO "anon";
GRANT ALL ON TABLE "public"."mission_rerolls" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_rerolls" TO "service_role";



GRANT ALL ON TABLE "public"."mission_rewards" TO "anon";
GRANT ALL ON TABLE "public"."mission_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."mission_type_config" TO "anon";
GRANT ALL ON TABLE "public"."mission_type_config" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_type_config" TO "service_role";



GRANT ALL ON TABLE "public"."moves" TO "anon";
GRANT ALL ON TABLE "public"."moves" TO "authenticated";
GRANT ALL ON TABLE "public"."moves" TO "service_role";



GRANT ALL ON SEQUENCE "public"."moves_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."moves_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."moves_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."player_grants" TO "anon";
GRANT ALL ON TABLE "public"."player_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."player_grants" TO "service_role";



GRANT ALL ON TABLE "public"."player_metric_tiers" TO "anon";
GRANT ALL ON TABLE "public"."player_metric_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."player_metric_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."player_metrics" TO "anon";
GRANT ALL ON TABLE "public"."player_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."player_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."player_mission_difficulty" TO "anon";
GRANT ALL ON TABLE "public"."player_mission_difficulty" TO "authenticated";
GRANT ALL ON TABLE "public"."player_mission_difficulty" TO "service_role";



GRANT ALL ON TABLE "public"."player_streak" TO "anon";
GRANT ALL ON TABLE "public"."player_streak" TO "authenticated";
GRANT ALL ON TABLE "public"."player_streak" TO "service_role";



GRANT ALL ON TABLE "public"."player_weekly_pass" TO "anon";
GRANT ALL ON TABLE "public"."player_weekly_pass" TO "authenticated";
GRANT ALL ON TABLE "public"."player_weekly_pass" TO "service_role";



GRANT ALL ON TABLE "public"."podium_images" TO "anon";
GRANT ALL ON TABLE "public"."podium_images" TO "authenticated";
GRANT ALL ON TABLE "public"."podium_images" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT ALL ON TABLE "public"."reroll_pricing_config" TO "anon";
GRANT ALL ON TABLE "public"."reroll_pricing_config" TO "authenticated";
GRANT ALL ON TABLE "public"."reroll_pricing_config" TO "service_role";



GRANT ALL ON TABLE "public"."store_config" TO "anon";
GRANT ALL ON TABLE "public"."store_config" TO "authenticated";
GRANT ALL ON TABLE "public"."store_config" TO "service_role";



GRANT ALL ON TABLE "public"."store_sales" TO "anon";
GRANT ALL ON TABLE "public"."store_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."store_sales" TO "service_role";



GRANT ALL ON TABLE "public"."streak_chest_rewards" TO "anon";
GRANT ALL ON TABLE "public"."streak_chest_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."streak_chest_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."table_configs" TO "anon";
GRANT ALL ON TABLE "public"."table_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."table_configs" TO "service_role";



GRANT ALL ON TABLE "public"."user_board_inventory" TO "anon";
GRANT ALL ON TABLE "public"."user_board_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_board_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."user_daily_bonuses" TO "anon";
GRANT ALL ON TABLE "public"."user_daily_bonuses" TO "authenticated";
GRANT ALL ON TABLE "public"."user_daily_bonuses" TO "service_role";



GRANT ALL ON TABLE "public"."user_inventory" TO "anon";
GRANT ALL ON TABLE "public"."user_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."user_wheel_spins" TO "anon";
GRANT ALL ON TABLE "public"."user_wheel_spins" TO "authenticated";
GRANT ALL ON TABLE "public"."user_wheel_spins" TO "service_role";



GRANT ALL ON TABLE "public"."user_xp_boosts" TO "anon";
GRANT ALL ON TABLE "public"."user_xp_boosts" TO "authenticated";
GRANT ALL ON TABLE "public"."user_xp_boosts" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."wheel_configs" TO "anon";
GRANT ALL ON TABLE "public"."wheel_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."wheel_configs" TO "service_role";



GRANT ALL ON TABLE "public"."wheel_slots" TO "anon";
GRANT ALL ON TABLE "public"."wheel_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."wheel_slots" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







