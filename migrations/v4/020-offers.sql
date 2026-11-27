-- v4/020: предложения бота (этап 1 «Мозг магазина», шаг 6). Только схема v4.
-- Применяет Яков после 019.
--
-- Главное:
--  * Кнопка «Купить» ведёт не на товар, а на предложение: короткий id (влезает в
--    64 байта callback_data Telegram), один или несколько товаров («5-6-7 класс» —
--    одна кнопка на сумму), цена каждого и итог на момент показа, срок 72 часа.
--  * Нажатие — claim_offer: заказ создаётся один раз. Восемь нажатий подряд или
--    одновременно дают один заказ (Д1; в v3 create_order без ключа давал 8 заказов).
--  * Цена изменилась или срок вышел — отказ offer_stale, бот показывает новое
--    предложение (Д3): покупатель платит то, что видел, или видит новую цену.
--  * Предложение в тени заказа не создаёт; в тесте — пробный заказ (is_test).

create table v4.offers (
  id text primary key check (id ~ '^[A-HJ-NP-Z2-9]{8}$'),
  bot_id uuid not null references v4.shops (bot_id),
  buyer_id uuid not null,
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 10),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Цена каждого товара на момент показа, в том же порядке, что product_ids.
  prices_minor bigint[] not null,
  total_minor bigint not null check (total_minor >= 0),
  mode text not null default 'live' check (mode in ('live', 'shadow', 'test')),
  expires_at timestamptz not null,
  order_id uuid,
  claimed_at timestamptz,
  message_id bigint,
  -- Напоминание о брошенном предложении (этап 2) — условной записью, один раз.
  nudged_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check (cardinality(prices_minor) = cardinality(product_ids)),
  check ((order_id is null) = (claimed_at is null))
);
create index offers_buyer on v4.offers (bot_id, buyer_id, created_at desc);

-- Короткий id без похожих знаков (нет I, O, 0, 1).
create or replace function v4.offer_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8)
$$;

-- Показать предложение. Товары — только активные и без вариантов (у товара с
-- вариантами покупатель выбирает вариант: отказ choose_variant). Цена — по стране
-- покупателя, как выберет create_order.
create or replace function v4.create_offer(
  p_bot_id uuid, p_buyer_id uuid, p_product_ids uuid[], p_mode text default 'live',
  p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  ctry text;
  cur text;
  prices bigint[];
  oid text;
  tries integer := 0;
begin
  if coalesce(cardinality(p_product_ids), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'v4:empty_order';
  end if;
  if cardinality(p_product_ids) > 10 then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if exists (select 1 from unnest(p_product_ids) u(id)
             where v4.product_details(p_bot_id, u.id, null) is null) then
    raise exception using errcode = 'P0001', message = 'v4:product_unavailable';
  end if;
  if exists (select 1 from unnest(p_product_ids) u(id)
             where exists (select 1 from v4.products c where c.parent_id = u.id and c.status = 'active')) then
    raise exception using errcode = 'P0001', message = 'v4:choose_variant';
  end if;
  select country into ctry from v4.buyers where bot_id = p_bot_id and id = p_buyer_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  select q.currency into cur from v4.quote(p_bot_id, p_product_ids, ctry) q;
  select array_agg(v4.price_minor(p_bot_id, u.id, cur) order by u.i) into prices
  from unnest(p_product_ids) with ordinality u(id, i);
  loop
    oid := v4.offer_code();
    begin
      insert into v4.offers (id, bot_id, buyer_id, product_ids, currency, prices_minor, total_minor, mode,
                             expires_at, created_at)
      values (oid, p_bot_id, p_buyer_id, p_product_ids, cur, prices,
              (select sum(x) from unnest(prices) x), p_mode, p_now + interval '72 hours', p_now);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object(
    'offer_id', oid, 'currency', cur, 'total_minor', (select sum(x) from unnest(prices) x),
    'items', (select jsonb_agg(jsonb_build_object('product_id', u.id,
                'title', v4.product_details(p_bot_id, u.id, null) ->> 'title', 'amount_minor', prices[u.i])
              order by u.i)
              from unnest(p_product_ids) with ordinality u(id, i)));
end $$;

-- Нажатие «Купить». Под блокировкой строки предложения: первое нажатие создаёт
-- заказ, остальные получают тот же (reused). Итог:
--  {ok:true, order_id, order_no, reused} или {ok:false, reason}:
--  not_found, expired, price_changed (цена не та, что показана), shadow.
create or replace function v4.claim_offer(
  p_bot_id uuid, p_buyer_id uuid, p_offer_id text, p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  f v4.offers;
  ctry text;
  q record;
  o v4.orders;
begin
  select * into f from v4.offers where id = upper(p_offer_id) and bot_id = p_bot_id for update;
  if not found or f.buyer_id <> p_buyer_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if f.order_id is not null then
    select * into o from v4.orders where id = f.order_id;
    return jsonb_build_object('ok', true, 'order_id', o.id, 'order_no', o.no, 'reused', true,
                              'status', o.status);
  end if;
  if f.mode = 'shadow' then return jsonb_build_object('ok', false, 'reason', 'shadow'); end if;
  if f.expires_at <= p_now then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select country into ctry from v4.buyers where bot_id = p_bot_id and id = p_buyer_id;
  select * into q from v4.quote(p_bot_id, f.product_ids, ctry);
  if q.currency <> f.currency or q.total_minor <> f.total_minor
     or exists (select 1 from unnest(f.product_ids) u(id) where v4.product_details(p_bot_id, u.id, null) is null) then
    return jsonb_build_object('ok', false, 'reason', 'price_changed');
  end if;
  o := v4.create_order(p_bot_id, p_buyer_id, ctry, f.product_ids, 0, f.mode = 'test', 'buyer');
  update v4.offers set order_id = o.id, claimed_at = p_now where id = f.id;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_no', o.no, 'reused', false, 'status', o.status);
end $$;

-- Привязать предложение к сообщению журнала (кнопка была в этом ответе).
create or replace function v4.attach_offers(p_bot_id uuid, p_offer_ids text[], p_message_id bigint)
returns integer language sql as $$
  with u as (
    update v4.offers set message_id = p_message_id
    where bot_id = p_bot_id and id = any (p_offer_ids) and message_id is null returning 1)
  select count(*)::int from u
$$;

alter table v4.offers enable row level security;
create policy tenant_isolation on v4.offers for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
revoke all on v4.offers from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.offers to service_role;
grant select, insert on v4.offers to tenant_bot;
grant update (order_id, claimed_at, message_id, nudged_at) on v4.offers to tenant_bot;

revoke all on function v4.offer_code(), v4.create_offer(uuid, uuid, uuid[], text, timestamptz),
  v4.claim_offer(uuid, uuid, text, timestamptz), v4.attach_offers(uuid, text[], bigint)
  from public, anon, authenticated;
grant execute on function v4.offer_code(), v4.create_offer(uuid, uuid, uuid[], text, timestamptz),
  v4.claim_offer(uuid, uuid, text, timestamptz), v4.attach_offers(uuid, text[], bigint)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 1 таблицу и 2 функции):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename = 'offers') as tables,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'v4' and p.proname in ('create_offer', 'claim_offer')) as fns;
