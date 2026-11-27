-- v4/024: покупка, склад, выдача физического заказа, школа, VIP, площадка,
-- рассылка, счёт платформы и предполёт. Только схема v4. Применяет Яков после 023.
--
-- Главное:
--  * Шлюзы stripe, kaspi, nowpayments пишут в ту же книгу, что robokassa:
--    повтор (bot_id, method, external_ref) — та же запись. Комиссия — с автооплат.
--  * Остаток — сумма движений. Продажа ниже нуля отказывается. Инвентаризация
--    пишет разницу, историю не переписывает.
--  * Физический заказ идёт шагами accepted → working → ready → handed.
--    Шаг нельзя перескочить. Первый шаг открывает одно дело fulfillment.
--  * Курс — клуб со сроком плюс уроки. Урок отмечается только при живом доступе.
--  * WhatsApp: маркетинговая отправка только внутри 24 часов после входящего.
--  * Площадка читает товары магазинов с listed_on_market. Заказ — тот же create_order.
--  * Счёт платформы пишет книга book = billing, только эта функция (сервисная роль).

alter table v4.buyer_channels add column last_inbound_at timestamptz;
alter table v4.products add column track_stock boolean not null default false;
alter table v4.shops add column listed_on_market boolean not null default false;

-- ── шлюзы ────────────────────────────────────────────────────────────────────
-- Имена проверок столбца в Postgres 17: payment_methods_kind_check и
-- ledger_method_check. Поиск «любая проверка со словом kind» снимал соседнюю
-- проверку перевода (kind <> 'transfer') и оставлял старый список способов.
alter table v4.payment_methods drop constraint payment_methods_kind_check;
alter table v4.ledger drop constraint ledger_method_check;
alter table v4.payment_methods add constraint payment_methods_kind_check
  check (kind in ('transfer', 'prodamus', 'apipay', 'robokassa', 'stripe', 'kaspi', 'nowpayments'));
alter table v4.ledger add constraint ledger_method_check
  check (method in ('transfer', 'prodamus', 'apipay', 'robokassa', 'stripe', 'kaspi', 'nowpayments', 'manual', 'legacy'));

create or replace function v4.is_auto_pay(p_method text) returns boolean
language sql immutable as $$
  select p_method in ('prodamus', 'apipay', 'robokassa', 'stripe', 'kaspi', 'nowpayments')
$$;

create or replace function v4.record_payment(
  p_bot_id uuid, p_order_id uuid, p_amount_minor bigint, p_currency text,
  p_method text, p_external_ref text, p_created_by text, p_note text default null
) returns table (
  entry_id bigint, duplicate boolean, became_paid boolean, order_closed boolean,
  currency_mismatch boolean, paid_minor bigint, due_minor bigint
) language plpgsql as $$
declare
  o v4.orders;
  before_paid bigint;
  after_paid bigint;
  eid bigint;
  fee_bp integer;
  fee bigint;
  s v4.shops;
  rate numeric;
  earn integer;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  before_paid := v4.order_paid_minor(o.id, o.currency);

  insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, note, created_by)
  values (p_bot_id, o.id, 'payment', p_amount_minor, p_currency, p_method, p_external_ref, p_note, p_created_by)
  on conflict (bot_id, method, external_ref) do nothing
  returning id into eid;

  if eid is null then
    select l.id into eid from v4.ledger l
    where l.bot_id = p_bot_id and l.method = p_method and l.external_ref = p_external_ref;
    after_paid := before_paid;
    return query select eid, true, false, o.status in ('expired', 'cancelled'), p_currency <> o.currency,
      after_paid, greatest(o.total_minor - after_paid, 0);
    return;
  end if;

  after_paid := v4.order_paid_minor(o.id, o.currency);
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'payment', jsonb_build_object('entry_id', eid, 'amount_minor', p_amount_minor,
          'currency', p_currency, 'method', p_method, 'external_ref', p_external_ref), p_created_by);
  if p_currency <> o.currency then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'currency_mismatch', jsonb_build_object('entry_id', eid, 'order_currency', o.currency), p_created_by);
  end if;
  if o.status in ('expired', 'cancelled') then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'payment_on_closed', jsonb_build_object('entry_id', eid, 'status', o.status), p_created_by);
  end if;

  if v4.is_auto_pay(p_method) then
    select max(pm.fee_bp) into fee_bp from v4.payment_methods pm
    where pm.bot_id = p_bot_id and pm.kind = p_method and pm.currency = p_currency;
    fee := round(p_amount_minor * coalesce(fee_bp, 0) / 10000.0)::bigint;
    if fee > 0 then
      insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, created_by)
      values (p_bot_id, o.id, 'platform_fee', -fee, p_currency, p_method, 'fee:' || p_external_ref, p_created_by);
    end if;
  end if;

  became_paid := before_paid < o.total_minor and after_paid >= o.total_minor;
  if became_paid then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'paid', jsonb_build_object('paid_minor', after_paid, 'currency', o.currency), p_created_by);
    select * into s from v4.shops where bot_id = p_bot_id;
    rate := v4.rate(p_bot_id, o.currency);
    if not o.is_test and s.points_earn_pct > 0 and rate is not null then
      earn := floor(o.total_minor / 100.0 / rate * s.points_earn_pct / 100)::integer;
      if earn > 0 then
        insert into v4.points (bot_id, buyer_id, order_id, kind, delta, created_by)
        values (p_bot_id, o.buyer_id, o.id, 'earn', earn, p_created_by)
        on conflict do nothing;
      end if;
    end if;
  end if;
  if after_paid > o.total_minor and before_paid <= o.total_minor then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'overpaid', jsonb_build_object('over_minor', after_paid - o.total_minor), p_created_by);
  end if;

  return query select eid, false, became_paid, o.status in ('expired', 'cancelled'), p_currency <> o.currency,
    after_paid, greatest(o.total_minor - after_paid, 0);
end $$;

-- ── покупатель канала и окно WhatsApp ───────────────────────────────────────
create or replace function v4.touch_buyer(
  p_bot_id uuid, p_channel text, p_external_id text, p_now timestamptz default now(),
  p_country text default null, p_language text default null, p_name text default null
) returns uuid language plpgsql as $$
declare
  bid uuid;
begin
  if p_channel not in ('telegram', 'instagram', 'whatsapp', 'web') then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  select buyer_id into bid from v4.buyer_channels
   where bot_id = p_bot_id and channel = p_channel and external_id = p_external_id
   for update;
  if found then
    update v4.buyer_channels set last_inbound_at = p_now
     where bot_id = p_bot_id and channel = p_channel and external_id = p_external_id;
    return bid;
  end if;
  insert into v4.buyers (bot_id, country, language, name)
  values (p_bot_id, p_country, p_language, p_name)
  returning id into bid;
  insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id, last_inbound_at)
  values (p_bot_id, p_channel, p_external_id, bid, p_now);
  return bid;
end $$;

create or replace function v4.reply_window_open(
  p_bot_id uuid, p_channel text, p_external_id text, p_now timestamptz default now()
) returns boolean language sql stable as $$
  select case
    when p_channel <> 'whatsapp' then true
    else exists (
      select 1 from v4.buyer_channels c
      where c.bot_id = p_bot_id and c.channel = p_channel and c.external_id = p_external_id
        and c.last_inbound_at is not null and c.last_inbound_at > p_now - interval '24 hours')
  end
$$;

-- ── каталог и заказ со складом ───────────────────────────────────────────────
create or replace function v4.save_product(
  p_bot_id uuid, p_title text, p_kind text, p_price_minor bigint,
  p_description text default null, p_product_id uuid default null,
  p_track_stock boolean default false
) returns uuid language plpgsql as $$
declare
  pid uuid;
begin
  if p_kind not in ('file', 'club') or coalesce(p_title, '') = '' or p_price_minor is null or p_price_minor < 0 then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_product_id is null then
    insert into v4.products (bot_id, title, kind, base_price_minor, description, track_stock)
    values (p_bot_id, p_title, p_kind, p_price_minor, p_description, p_track_stock)
    returning id into pid;
    return pid;
  end if;
  update v4.products set title = p_title, description = p_description,
    base_price_minor = p_price_minor, track_stock = p_track_stock
   where id = p_product_id and bot_id = p_bot_id
   returning id into pid;
  if pid is null then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  return pid;
end $$;

create table v4.stock_moves (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  product_id uuid not null,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('receipt', 'sale', 'writeoff', 'stocktake')),
  external_ref text not null check (external_ref <> ''),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (bot_id, external_ref),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);

create or replace function v4.stock_on_hand(p_bot_id uuid, p_product_id uuid)
returns integer language sql stable as $$
  select coalesce(sum(delta), 0)::integer from v4.stock_moves
   where bot_id = p_bot_id and product_id = p_product_id
$$;

create or replace function v4.move_stock(
  p_bot_id uuid, p_product_id uuid, p_delta integer, p_reason text,
  p_external_ref text, p_created_by text
) returns integer language plpgsql as $$
declare
  on_hand integer;
  wrote integer;
begin
  perform 1 from v4.products where id = p_product_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  if p_reason not in ('receipt', 'sale', 'writeoff', 'stocktake') or p_delta is null or p_delta = 0 then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  on_hand := v4.stock_on_hand(p_bot_id, p_product_id);
  if on_hand + p_delta < 0 then
    raise exception using errcode = 'P0001', message = 'v4:stock_negative';
  end if;
  insert into v4.stock_moves (bot_id, product_id, delta, reason, external_ref, created_by)
  values (p_bot_id, p_product_id, p_delta, p_reason, p_external_ref, p_created_by)
  on conflict (bot_id, external_ref) do nothing;
  get diagnostics wrote = row_count;
  if wrote = 1 and on_hand + p_delta = 0 then
    perform v4.open_case(p_bot_id, 'stock_low', 'product:' || p_product_id::text, p_created_by, null, null,
      jsonb_build_object('product_id', p_product_id));
  end if;
  return v4.stock_on_hand(p_bot_id, p_product_id);
end $$;

create or replace function v4.stocktake(
  p_bot_id uuid, p_product_id uuid, p_target integer, p_external_ref text, p_created_by text
) returns integer language plpgsql as $$
declare
  delta integer;
begin
  if p_target is null or p_target < 0 then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  perform 1 from v4.products where id = p_product_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  delta := p_target - v4.stock_on_hand(p_bot_id, p_product_id);
  if delta = 0 then return p_target; end if;
  return v4.move_stock(p_bot_id, p_product_id, delta, 'stocktake', p_external_ref, p_created_by);
end $$;

create or replace function v4.place_order(
  p_bot_id uuid, p_buyer_id uuid, p_country text, p_product_ids uuid[],
  p_points integer default 0, p_is_test boolean default false, p_created_by text default 'bot'
) returns v4.orders language plpgsql as $$
declare
  o v4.orders;
  item record;
begin
  o := v4.create_order(p_bot_id, p_buyer_id, p_country, p_product_ids, p_points, p_is_test, p_created_by);
  for item in select id, product_id from v4.order_items where order_id = o.id loop
    if exists (select 1 from v4.products p where p.id = item.product_id and p.track_stock) then
      perform v4.move_stock(p_bot_id, item.product_id, -1, 'sale', 'item:' || item.id::text, p_created_by);
    end if;
  end loop;
  return o;
end $$;

-- ── физический заказ ─────────────────────────────────────────────────────────
insert into v4.case_policies values
  ('fulfillment', 'seller', '4 hours', 'remind', '24 hours', 'escalate', true, 'now'),
  ('stock_low', 'seller', '24 hours', 'remind', null, null, false, 'digest'),
  ('giveaway', 'seller', '24 hours', 'remind', null, null, false, 'digest'),
  ('waitlist', 'seller', '24 hours', 'remind', null, null, false, 'digest');

create table v4.fulfillment_steps (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  order_id uuid not null,
  step text not null check (step in ('accepted', 'working', 'ready', 'handed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (order_id, step),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id)
);

create or replace function v4.advance_fulfillment(
  p_bot_id uuid, p_order_id uuid, p_step text, p_created_by text
) returns text language plpgsql as $$
declare
  last_step text;
  expect text;
begin
  perform 1 from v4.orders where id = p_order_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  select step into last_step from v4.fulfillment_steps
   where order_id = p_order_id order by id desc limit 1;
  expect := case last_step
    when 'accepted' then 'working'
    when 'working' then 'ready'
    when 'ready' then 'handed'
    else 'accepted' end;
  if last_step = 'handed' or p_step is distinct from expect then
    raise exception using errcode = 'P0001', message = 'v4:bad_step';
  end if;
  insert into v4.fulfillment_steps (bot_id, order_id, step, created_by)
  values (p_bot_id, p_order_id, p_step, p_created_by);
  if p_step = 'accepted' then
    perform v4.open_case(p_bot_id, 'fulfillment', 'order:' || p_order_id::text, p_created_by,
      null, p_order_id, jsonb_build_object('step', p_step));
  end if;
  return p_step;
end $$;

-- ── школа: уроки на доступе клуба ────────────────────────────────────────────
create table v4.lessons (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  product_id uuid not null,
  title text not null check (title <> ''),
  position integer not null check (position > 0),
  unique (product_id, position),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);

create table v4.lesson_progress (
  bot_id uuid not null,
  buyer_id uuid not null,
  lesson_id uuid not null references v4.lessons (id),
  completed_at timestamptz not null default now(),
  primary key (buyer_id, lesson_id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);

create or replace function v4.add_lesson(
  p_bot_id uuid, p_product_id uuid, p_title text, p_position integer
) returns uuid language plpgsql as $$
declare
  lid uuid;
begin
  if not exists (select 1 from v4.products where id = p_product_id and bot_id = p_bot_id and kind = 'club') then
    raise exception using errcode = 'P0001', message = 'v4:product_not_found';
  end if;
  insert into v4.lessons (bot_id, product_id, title, position)
  values (p_bot_id, p_product_id, p_title, p_position)
  returning id into lid;
  return lid;
end $$;

create or replace function v4.complete_lesson(
  p_bot_id uuid, p_buyer_id uuid, p_lesson_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql as $$
declare
  prod uuid;
  wrote integer;
begin
  select product_id into prod from v4.lessons where id = p_lesson_id and bot_id = p_bot_id;
  if prod is null then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  if not exists (
    select 1 from v4.access a
    where a.bot_id = p_bot_id and a.buyer_id = p_buyer_id and a.product_id = prod
      and a.status = 'active' and (a.ends_at is null or a.ends_at > p_now)
  ) then
    raise exception using errcode = 'P0001', message = 'v4:no_access';
  end if;
  insert into v4.lesson_progress (bot_id, buyer_id, lesson_id, completed_at)
  values (p_bot_id, p_buyer_id, p_lesson_id, p_now)
  on conflict do nothing;
  get diagnostics wrote = row_count;
  return wrote = 1;
end $$;

-- ── VIP: снимок числа людей в группе и живые доступы ────────────────────────
create table v4.vip_groups (
  bot_id uuid primary key references v4.shops (bot_id),
  chat_id text not null check (chat_id <> ''),
  member_count integer check (member_count >= 0),
  counted_at timestamptz
);

create or replace function v4.note_vip_count(
  p_bot_id uuid, p_chat_id text, p_count integer, p_now timestamptz default now()
) returns integer language plpgsql as $$
begin
  if p_count is null or p_count < 0 or coalesce(p_chat_id, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  insert into v4.vip_groups (bot_id, chat_id, member_count, counted_at)
  values (p_bot_id, p_chat_id, p_count, p_now)
  on conflict (bot_id) do update set chat_id = excluded.chat_id,
    member_count = excluded.member_count, counted_at = excluded.counted_at;
  return p_count;
end $$;

create or replace function v4.vip_active_access(p_bot_id uuid, p_now timestamptz default now())
returns integer language sql stable as $$
  select count(*)::integer from v4.access a
  join v4.vip_groups g on g.bot_id = a.bot_id
  join v4.products p on p.id = a.product_id and p.club_chat_id = g.chat_id
  where a.bot_id = p_bot_id and a.status = 'active' and a.kind = 'club'
    and a.ends_at > p_now
$$;

-- ── площадка, розыгрыш, лист ожидания, рассылка ─────────────────────────────
create or replace function v4.set_market_listing(p_bot_id uuid, p_listed boolean)
returns boolean language plpgsql as $$
begin
  update v4.shops set listed_on_market = p_listed where bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:shop_not_found'; end if;
  return p_listed;
end $$;

create or replace function v4.market_products(p_query text default '')
returns table (bot_id uuid, product_id uuid, title text, base_price_minor bigint, currency text)
language sql stable as $$
  select p.bot_id, p.id, p.title, p.base_price_minor, s.base_currency
  from v4.products p
  join v4.shops s on s.bot_id = p.bot_id
  where s.listed_on_market and p.status = 'active' and p.parent_id is null
    and (coalesce(p_query, '') = '' or p.title ilike '%' || p_query || '%')
  order by p.title, p.id
  limit 50
$$;

create table v4.giveaway_entries (
  giveaway_id uuid not null,
  bot_id uuid not null,
  buyer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (giveaway_id, buyer_id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);

create or replace function v4.enter_giveaway(p_bot_id uuid, p_giveaway_id uuid, p_buyer_id uuid)
returns boolean language plpgsql as $$
declare wrote integer;
begin
  insert into v4.giveaway_entries (giveaway_id, bot_id, buyer_id)
  values (p_giveaway_id, p_bot_id, p_buyer_id)
  on conflict do nothing;
  get diagnostics wrote = row_count;
  if wrote = 1 then
    perform v4.open_case(p_bot_id, 'giveaway', 'giveaway:' || p_giveaway_id::text, 'buyer', p_buyer_id, null, '{}'::jsonb);
  end if;
  return wrote = 1;
end $$;

create table v4.waitlist (
  bot_id uuid not null,
  product_id uuid not null,
  buyer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (product_id, buyer_id),
  foreign key (bot_id, product_id) references v4.products (bot_id, id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);

create or replace function v4.join_waitlist(p_bot_id uuid, p_product_id uuid, p_buyer_id uuid)
returns boolean language plpgsql as $$
declare wrote integer;
begin
  if not exists (select 1 from v4.products where id = p_product_id and bot_id = p_bot_id) then
    raise exception using errcode = 'P0001', message = 'v4:product_not_found';
  end if;
  insert into v4.waitlist (bot_id, product_id, buyer_id)
  values (p_bot_id, p_product_id, p_buyer_id)
  on conflict do nothing;
  get diagnostics wrote = row_count;
  if wrote = 1 then
    perform v4.open_case(p_bot_id, 'waitlist', 'product:' || p_product_id::text || ':buyer:' || p_buyer_id::text,
      'buyer', p_buyer_id, null, jsonb_build_object('product_id', p_product_id));
  end if;
  return wrote = 1;
end $$;

create or replace function v4.enqueue_broadcast(
  p_bot_id uuid, p_dedupe_key text, p_text text, p_created_by text
) returns boolean language plpgsql as $$
begin
  if coalesce(p_text, '') = '' or coalesce(p_dedupe_key, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  return v4.enqueue_job('broadcast', p_bot_id::text || ':' || p_dedupe_key, p_bot_id,
    jsonb_build_object('text', p_text, 'by', p_created_by));
end $$;

-- ── списки рабочего места ────────────────────────────────────────────────────
create or replace function v4.list_orders(p_bot_id uuid, p_limit integer default 50)
returns table (
  order_id uuid, no bigint, status text, currency text,
  total_minor bigint, paid_minor bigint, due_minor bigint, money_state text
) language sql stable as $$
  select o.id, o.no, o.status, m.currency, m.total_minor, m.paid_minor, m.due_minor, m.money_state
  from v4.orders o
  join v4.order_money m on m.order_id = o.id and m.bot_id = o.bot_id
  where o.bot_id = p_bot_id
  order by o.created_at desc, o.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

create or replace function v4.list_products(p_bot_id uuid)
returns table (
  id uuid, title text, kind text, status text, base_price_minor bigint,
  description text, track_stock boolean, on_hand integer
) language sql stable as $$
  select p.id, p.title, p.kind, p.status, p.base_price_minor, p.description, p.track_stock,
    v4.stock_on_hand(p.bot_id, p.id)
  from v4.products p
  where p.bot_id = p_bot_id and p.parent_id is null
  order by p.created_at, p.id
$$;

create or replace function v4.sales_days(p_bot_id uuid)
returns table (day date, currency text, amount_minor bigint, entries bigint)
language sql stable as $$
  select d.day, d.currency, sum(d.amount_minor)::bigint, sum(d.entries)::bigint
  from v4.daily_totals d
  where d.bot_id = p_bot_id and d.book = 'sales' and d.kind = 'payment'
  group by d.day, d.currency
  order by d.day desc
  limit 31
$$;

-- ── деньги платформы ─────────────────────────────────────────────────────────
create or replace function v4.record_platform_payment(
  p_bot_id uuid, p_invoice_id uuid, p_amount_minor bigint, p_currency text,
  p_external_ref text, p_created_by text
) returns table (entry_id bigint, duplicate boolean) language plpgsql as $$
declare
  eid bigint;
begin
  if not exists (select 1 from v4.invoices where id = p_invoice_id and bot_id = p_bot_id) then
    raise exception using errcode = 'P0001', message = 'v4:invoice_not_found';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or coalesce(p_external_ref, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  insert into v4.ledger (bot_id, book, invoice_id, kind, amount_minor, currency, method, external_ref, created_by)
  values (p_bot_id, 'billing', p_invoice_id, 'payment', p_amount_minor, p_currency, 'manual',
          'billing:' || p_external_ref, p_created_by)
  on conflict (bot_id, method, external_ref) do nothing
  returning id into eid;
  if eid is null then
    select id into eid from v4.ledger
     where bot_id = p_bot_id and method = 'manual' and external_ref = 'billing:' || p_external_ref;
    return query select eid, true;
    return;
  end if;
  update v4.invoices set status = 'confirmed', confirmed_at = now(), confirmed_by = p_created_by
   where id = p_invoice_id and status = 'draft';
  return query select eid, false;
end $$;

-- ── предполёт: пустой blockers значит можно готовить переключение ───────────
create or replace function v4.shop_preflight(p_bot_id uuid)
returns jsonb language plpgsql stable as $$
declare
  products integer;
  methods integer;
  empty_desc integer;
  open_cases integer;
  blockers text[] := '{}';
  warnings text[] := '{}';
begin
  if not exists (select 1 from v4.shops where bot_id = p_bot_id) then
    raise exception using errcode = 'P0001', message = 'v4:shop_not_found';
  end if;
  select count(*) into products from v4.products where bot_id = p_bot_id and status = 'active';
  select count(*) into methods from v4.payment_methods where bot_id = p_bot_id and active;
  select count(*) into empty_desc from v4.products
   where bot_id = p_bot_id and status = 'active' and coalesce(description, '') = '';
  select count(*) into open_cases from v4.cases where bot_id = p_bot_id and status = 'open';
  if products = 0 then blockers := blockers || array['no_products']; end if;
  if methods = 0 then blockers := blockers || array['no_payment_method']; end if;
  if empty_desc > 0 then warnings := warnings || array['empty_descriptions']; end if;
  if open_cases > 0 then warnings := warnings || array['open_cases']; end if;
  return jsonb_build_object(
    'blockers', to_jsonb(blockers),
    'warnings', to_jsonb(warnings),
    'products', products,
    'methods', methods,
    'empty_descriptions', empty_desc,
    'open_cases', open_cases
  );
end $$;

alter table v4.stock_moves enable row level security;
alter table v4.fulfillment_steps enable row level security;
alter table v4.lessons enable row level security;
alter table v4.lesson_progress enable row level security;
alter table v4.vip_groups enable row level security;
alter table v4.giveaway_entries enable row level security;
alter table v4.waitlist enable row level security;

create policy tenant_isolation on v4.stock_moves for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.fulfillment_steps for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.lessons for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.lesson_progress for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.vip_groups for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.giveaway_entries for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.waitlist for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.stock_moves, v4.fulfillment_steps, v4.lessons, v4.lesson_progress,
  v4.vip_groups, v4.giveaway_entries, v4.waitlist
  from public, anon, authenticated, tenant_bot;
grant select, insert on v4.stock_moves, v4.fulfillment_steps, v4.lessons, v4.lesson_progress,
  v4.giveaway_entries, v4.waitlist to service_role, tenant_bot;
grant select, insert, update on v4.vip_groups to service_role, tenant_bot;
grant update (listed_on_market) on v4.shops to tenant_bot;

revoke all on function v4.record_platform_payment(uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated, tenant_bot;
grant execute on function v4.record_platform_payment(uuid, uuid, bigint, text, text, text) to service_role;

revoke all on function
  v4.is_auto_pay(text),
  v4.touch_buyer(uuid, text, text, timestamptz, text, text, text),
  v4.reply_window_open(uuid, text, text, timestamptz),
  v4.save_product(uuid, text, text, bigint, text, uuid, boolean),
  v4.stock_on_hand(uuid, uuid),
  v4.move_stock(uuid, uuid, integer, text, text, text),
  v4.stocktake(uuid, uuid, integer, text, text),
  v4.place_order(uuid, uuid, text, uuid[], integer, boolean, text),
  v4.advance_fulfillment(uuid, uuid, text, text),
  v4.add_lesson(uuid, uuid, text, integer),
  v4.complete_lesson(uuid, uuid, uuid, timestamptz),
  v4.note_vip_count(uuid, text, integer, timestamptz),
  v4.vip_active_access(uuid, timestamptz),
  v4.set_market_listing(uuid, boolean),
  v4.market_products(text),
  v4.enter_giveaway(uuid, uuid, uuid),
  v4.join_waitlist(uuid, uuid, uuid),
  v4.enqueue_broadcast(uuid, text, text, text),
  v4.list_orders(uuid, integer),
  v4.list_products(uuid),
  v4.sales_days(uuid),
  v4.shop_preflight(uuid)
  from public, anon, authenticated;
grant execute on function
  v4.is_auto_pay(text),
  v4.touch_buyer(uuid, text, text, timestamptz, text, text, text),
  v4.reply_window_open(uuid, text, text, timestamptz),
  v4.save_product(uuid, text, text, bigint, text, uuid, boolean),
  v4.stock_on_hand(uuid, uuid),
  v4.move_stock(uuid, uuid, integer, text, text, text),
  v4.stocktake(uuid, uuid, integer, text, text),
  v4.place_order(uuid, uuid, text, uuid[], integer, boolean, text),
  v4.advance_fulfillment(uuid, uuid, text, text),
  v4.add_lesson(uuid, uuid, text, integer),
  v4.complete_lesson(uuid, uuid, uuid, timestamptz),
  v4.note_vip_count(uuid, text, integer, timestamptz),
  v4.vip_active_access(uuid, timestamptz),
  v4.set_market_listing(uuid, boolean),
  v4.market_products(text),
  v4.enter_giveaway(uuid, uuid, uuid),
  v4.join_waitlist(uuid, uuid, uuid),
  v4.enqueue_broadcast(uuid, text, text, text),
  v4.list_orders(uuid, integer),
  v4.list_products(uuid),
  v4.sales_days(uuid),
  v4.shop_preflight(uuid)
  to service_role, tenant_bot;

-- Проверка (должна вернуть 7 таблиц и политику fulfillment):
-- select (select count(*) from information_schema.tables where table_schema = 'v4'
--           and table_name in ('stock_moves','fulfillment_steps','lessons','lesson_progress','vip_groups','giveaway_entries','waitlist')) as tables,
--        (select count(*) from v4.case_policies where kind = 'fulfillment') as policy;
