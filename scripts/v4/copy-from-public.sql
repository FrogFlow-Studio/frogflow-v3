-- Перенос одного клиента из public (v3) в v4. Запускает Яков в SQL-редакторе Supabase
-- в день переезда, ПОСЛЕ миграций v4 001–009 и только по своему «да»:
--
--   1) выполнить этот файл целиком (создаёт функцию v4.copy_from_public);
--   2) select v4.copy_from_public('<bot_id>');  -- вернёт отчёт: сколько перенесено и что осталось;
--   3) повторный вызов безопасен: уже перенесённое не дублируется.
--
-- public только ЧИТАЕТСЯ: ни одна строка v3 не меняется. Клиента на v4 эта функция
-- не переключает (settings.served_by меняет оператор отдельно).
--
-- Что переносится:
--   магазин; покупатели и их аккаунты в каналах; баллы — одной записью «migrated»
--   (баланс на момент переноса; после переезда баллы ведёт только v4);
--   товары и варианты (id те же), цены по странам, файлы по языкам; реквизиты оплаты;
--   VIP-тариф — товар-клуб, активные подписки — доступ до их срока;
--   выданные заказы — доступ к купленному (для кабинета «потерял файл»);
--   счётчик номеров заказов — с последнего номера v3, чтобы номера не повторились.
-- Что НЕ переносится (в отчёте — сколько): открытые заказы (закрыть в v3 до переезда),
--   VIP-заявки без оплаты и истёкшие подписки, строки заказов без товара.

create or replace function v4.copy_from_public(p_bot_id uuid) returns jsonb
language plpgsql as $$
declare
  s jsonb;
  tz text;
  n_buyers integer; n_channels integer; n_points integer; n_products integer; n_variants integer;
  n_prices integer; n_files integer; n_methods integer; n_clubs integer; n_club_access integer;
  n_file_access integer;
begin
  select settings into s from public.bots where id = p_bot_id;
  if s is null then raise exception 'v4:not_found'; end if;
  tz := coalesce(nullif(s ->> 'timezone', ''), 'Asia/Almaty');

  insert into v4.shops (bot_id, base_currency, timezone)
  values (p_bot_id, 'KZT', tz)
  on conflict (bot_id) do nothing;

  -- Покупатели: один на ключ v3 (ig_…, tg_…, wa_…); id выводится из ключа — повтор не дублирует.
  with u as (
    select u.*, (md5('v4buyer:' || p_bot_id || ':' || u.user_key))::uuid as v4_id,
      (select o.country_code from public.orders o
       where o.bot_id = p_bot_id and o.user_key = u.user_key and o.country_code ~ '^[A-Z]{2}$'
       order by o.created_at desc, o.id desc limit 1) as last_country
    from public.bot_users u
    where u.bot_id = p_bot_id and u.user_key ~ '^(ig|tg|wa)_.+'
  ), ins as (
    insert into v4.buyers (id, bot_id, name, country, language, email, created_at)
    select v4_id, p_bot_id,
      nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
      last_country,
      case when language_code in ('ru', 'kk', 'en', 'uz') then language_code end,
      nullif(email, ''), created_at
    from u
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_buyers from ins;

  with ins as (
    insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id)
    select p_bot_id,
      case left(u.user_key, 3) when 'ig_' then 'instagram' when 'tg_' then 'telegram' else 'whatsapp' end,
      substr(u.user_key, 4),
      (md5('v4buyer:' || p_bot_id || ':' || u.user_key))::uuid
    from public.bot_users u
    where u.bot_id = p_bot_id and u.user_key ~ '^(ig|tg|wa)_.+'
    on conflict (bot_id, channel, external_id) do nothing
    returning 1
  ) select count(*) into n_channels from ins;

  with ins as (
    insert into v4.points (bot_id, buyer_id, kind, delta, note, created_by)
    select p_bot_id, (md5('v4buyer:' || p_bot_id || ':' || u.user_key))::uuid, 'migrated', u.loyalty_points,
      'Баланс из v3 на ' || to_char(now() at time zone tz, 'DD.MM.YYYY HH24:MI'), 'copy_from_public'
    from public.bot_users u
    where u.bot_id = p_bot_id and u.user_key ~ '^(ig|tg|wa)_.+' and u.loyalty_points > 0
      and not exists (select 1 from v4.points p
                      where p.bot_id = p_bot_id and p.kind = 'migrated'
                        and p.buyer_id = (md5('v4buyer:' || p_bot_id || ':' || u.user_key))::uuid)
    returning 1
  ) select count(*) into n_points from ins;

  -- Товары: id те же, что в v3. Цена v3 — в тенге (у Копилки все товары KZT).
  with ins as (
    insert into v4.products (id, bot_id, title, kind, status, archived_at, base_price_minor, created_at)
    select p.id, p_bot_id, p.name, 'file',
      case when p.is_active then 'active' else 'archived' end,
      case when p.is_active then null else now() end,
      round(coalesce(p.price, 0) * 100)::bigint, p.created_at
    from public.products p
    where p.bot_id = p_bot_id and coalesce(p.currency, 'KZT') = 'KZT'
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_products from ins;

  with ins as (
    insert into v4.products (id, bot_id, parent_id, title, variant_label, kind, status, archived_at, base_price_minor)
    select v.id, p_bot_id, v.product_id, p.title, v.name, 'file', p.status, p.archived_at,
      round(coalesce(v.price, 0) * 100)::bigint
    from public.product_variants v
    join v4.products p on p.bot_id = p_bot_id and p.id = v.product_id
    where v.bot_id = p_bot_id and coalesce(btrim(v.name), '') <> ''
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_variants from ins;

  -- Цены по странам ({"KZ":1500,"RU":490}): валюта страны из справочника, кроме базовой.
  with ins as (
    insert into v4.product_prices (bot_id, product_id, currency, amount_minor)
    select p_bot_id, p.id, cc.currency, round((e.value)::numeric * 100)::bigint
    from public.products p
    cross join lateral jsonb_each_text(coalesce(p.country_prices, '{}'::jsonb)) e
    join v4.country_currency cc on cc.country = e.key
    where p.bot_id = p_bot_id and cc.currency <> 'KZT' and e.value ~ '^[0-9]+(\.[0-9]+)?$'
      and exists (select 1 from v4.products v where v.bot_id = p_bot_id and v.id = p.id)
    on conflict (product_id, currency) do nothing
    returning 1
  ) select count(*) into n_prices from ins;

  with ins as (
    insert into v4.product_files (id, bot_id, product_id, language, storage_path, file_name, sort)
    select f.id, p_bot_id, f.product_id,
      case when f.language in ('ru', 'kk', 'en', 'uz') then f.language end,
      f.file_path, coalesce(nullif(f.file_name, ''), f.file_path), coalesce(f.sort_order, 0)
    from public.product_material_files f
    where f.bot_id = p_bot_id and coalesce(f.file_path, '') <> ''
      and exists (select 1 from v4.products v where v.bot_id = p_bot_id and v.id = f.product_id)
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_files from ins;

  -- Реквизиты: перевод по стране. Автооплаты (Prodamus) подключает оператор отдельно.
  with ins as (
    insert into v4.payment_methods (id, bot_id, kind, country, currency, details, active)
    select m.id, p_bot_id, 'transfer', m.country_code, coalesce(nullif(m.currency, ''), 'KZT'),
      coalesce(m.instructions, ''), m.is_active
    from public.payment_methods m
    where m.bot_id = p_bot_id and m.country_code ~ '^[A-Z]{2}$'
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_methods from ins;

  -- VIP: тариф — товар-клуб с id тарифа.
  with ins as (
    insert into v4.products (id, bot_id, title, kind, status, archived_at, base_price_minor, term)
    select t.id, p_bot_id, t.name, 'club',
      case when t.is_active then 'active' else 'archived' end,
      case when t.is_active then null else now() end,
      round(coalesce(t.price, 0) * 100)::bigint,
      coalesce(make_interval(mins => t.duration_minutes), make_interval(days => t.duration_days))
    from public.vip_tariffs t
    where t.bot_id = p_bot_id and coalesce(t.currency, 'KZT') = 'KZT'
      and coalesce(t.duration_minutes, t.duration_days, 0) > 0
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_clubs from ins;

  -- Участники VIP живут в отдельном боте и часто не покупатели основного: заводим покупателя по Telegram.
  insert into v4.buyers (id, bot_id, name)
  select distinct on (s2.telegram_id) (md5('v4buyer:' || p_bot_id || ':tg_' || s2.telegram_id))::uuid, p_bot_id,
    nullif(btrim(coalesce(s2.first_name, '') || ' ' || coalesce(s2.last_name, '')), '')
  from public.vip_subscriptions s2
  where s2.bot_id = p_bot_id and s2.status = 'active' and s2.expires_at > now()
  order by s2.telegram_id, s2.created_at desc
  on conflict (id) do nothing;
  insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id)
  select distinct p_bot_id, 'telegram', s2.telegram_id::text, (md5('v4buyer:' || p_bot_id || ':tg_' || s2.telegram_id))::uuid
  from public.vip_subscriptions s2
  where s2.bot_id = p_bot_id and s2.status = 'active' and s2.expires_at > now()
  on conflict (bot_id, channel, external_id) do nothing;

  with ins as (
    insert into v4.access (id, bot_id, buyer_id, product_id, kind, source, starts_at, ends_at, created_by)
    select (md5('v4access:vip:' || s2.id))::uuid, p_bot_id,
      (md5('v4buyer:' || p_bot_id || ':tg_' || s2.telegram_id))::uuid, s2.tariff_id, 'club', 'migration',
      least(coalesce(s2.started_at, s2.created_at), s2.expires_at - interval '1 minute'), s2.expires_at,
      'copy_from_public'
    from public.vip_subscriptions s2
    where s2.bot_id = p_bot_id and s2.status = 'active' and s2.expires_at > now()
      and exists (select 1 from v4.products v where v.bot_id = p_bot_id and v.id = s2.tariff_id)
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_club_access from ins;

  -- Выданные заказы: доступ к купленному (вариант, если он был выбран).
  with ins as (
    insert into v4.access (id, bot_id, buyer_id, product_id, kind, source, starts_at, created_by)
    select (md5('v4access:item:' || i.id))::uuid, p_bot_id,
      (md5('v4buyer:' || p_bot_id || ':' || o.user_key))::uuid,
      coalesce(i.product_variant_id, i.product_id), 'file', 'migration', o.created_at, 'copy_from_public'
    from public.order_items i
    join public.orders o on o.id = i.order_id and o.bot_id = p_bot_id
    where o.status = 'delivered' and i.product_id is not null
      and exists (select 1 from v4.products v where v.bot_id = p_bot_id and v.id = coalesce(i.product_variant_id, i.product_id))
      and exists (select 1 from v4.buyers b where b.bot_id = p_bot_id
                  and b.id = (md5('v4buyer:' || p_bot_id || ':' || o.user_key))::uuid)
    on conflict (id) do nothing
    returning 1
  ) select count(*) into n_file_access from ins;

  insert into v4.order_counters (bot_id, last_no)
  select p_bot_id, coalesce(max(greatest(o.order_no, o.display_no)), 0) from public.orders o where o.bot_id = p_bot_id
  on conflict (bot_id) do update set last_no = greatest(v4.order_counters.last_no, excluded.last_no);

  return jsonb_build_object(
    'copied', jsonb_build_object(
      'buyers', n_buyers, 'channels', n_channels, 'points_balances', n_points,
      'products', n_products, 'variants', n_variants, 'country_prices', n_prices, 'files', n_files,
      'payment_methods', n_methods, 'clubs', n_clubs, 'club_access', n_club_access,
      'file_access', n_file_access),
    'order_counter', (select last_no from v4.order_counters where bot_id = p_bot_id),
    'not_copied', jsonb_build_object(
      'open_orders', (select count(*) from public.orders o where o.bot_id = p_bot_id
                      and o.status in ('awaiting_payment', 'awaiting_confirmation')),
      'vip_not_active', (select count(*) from public.vip_subscriptions s2 where s2.bot_id = p_bot_id
                         and not (s2.status = 'active' and s2.expires_at > now())),
      'items_without_product', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id
                                where o.bot_id = p_bot_id and o.status = 'delivered' and i.product_id is null),
      'products_not_kzt', (select count(*) from public.products p where p.bot_id = p_bot_id
                           and coalesce(p.currency, 'KZT') <> 'KZT'),
      'users_without_key', (select count(*) from public.bot_users u where u.bot_id = p_bot_id
                            and coalesce(u.user_key, '') !~ '^(ig|tg|wa)_.+')),
    'v4_totals', jsonb_build_object(
      'buyers', (select count(*) from v4.buyers where bot_id = p_bot_id),
      'products', (select count(*) from v4.products where bot_id = p_bot_id),
      'access', (select count(*) from v4.access where bot_id = p_bot_id),
      'points_migrated', (select coalesce(sum(delta), 0) from v4.points where bot_id = p_bot_id and kind = 'migrated'),
      'points_in_v3', (select coalesce(sum(loyalty_points), 0) from public.bot_users u where u.bot_id = p_bot_id
                       and u.user_key ~ '^(ig|tg|wa)_.+' and u.loyalty_points > 0)));
end $$;

revoke all on function v4.copy_from_public(uuid) from public, anon, authenticated, tenant_bot;
