-- v4/002: книга денег и заказы (этап 1; решения 1–5, 21, 31, 32, 50–55, 68, 70, 91–93).
-- Только схема v4. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- Главное:
--  * Заказ не хранит «оплачено». Оплачено = сумма записей книги денег по заказу
--    в его валюте (v4.order_money). Записи книги не меняются и не удаляются:
--    ошибка исправляется встречной записью (решения 1, 51, 54).
--  * Ничего не удаляем: заказ истекает или отменяется статусом с причиной (решение 2).
--  * «Один раз» — в базе: у каждой записи книги ключ (bot_id, method, external_ref),
--    повтор вебхука или двойной клик даёт ту же запись; заказ при оплате
--    блокируется (for update), поэтому «стал оплаченным» видит ровно один вызов.
--  * Деньги — в минимальных единицах (тиын, копейка) bigint, валюта — код ISO.
--  * Права: tenant_bot видит и пишет только своё (RLS по bot_id из JWT), удалять
--    не может ничего; счета платформы (book = 'billing') пишет только service_role.

-- ── арендатор из JWT (как public.current_bot_id в v3, но своя копия в v4) ──
create or replace function v4.current_bot_id() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'bot_id', '')::uuid
$$;

-- ── справочники ──────────────────────────────────────────────────────────────

-- Валюта страны покупателя (решение 91). Платформенный справочник, не про клиента.
create table v4.country_currency (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$')
);
insert into v4.country_currency (country, currency) values
  ('KZ', 'KZT'), ('RU', 'RUB'), ('KG', 'KGS'), ('BY', 'BYN'), ('UZ', 'UZS'),
  ('TM', 'TMT'), ('TJ', 'TJS'), ('AM', 'AMD'), ('AZ', 'AZN'), ('GE', 'GEL'),
  ('UA', 'UAH'), ('MD', 'MDL'), ('MN', 'MNT'), ('TR', 'TRY'), ('US', 'USD');

-- Магазин в v4: базовая валюта, баллы (решение 93), часовой пояс для выписки (52).
create table v4.shops (
  bot_id uuid primary key,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  points_earn_pct numeric(5, 2) not null default 0 check (points_earn_pct between 0 and 100),
  points_redeem_pct numeric(5, 2) not null default 0 check (points_redeem_pct between 0 and 100),
  timezone text not null default 'Asia/Almaty',
  created_at timestamptz not null default now()
);

-- Курс, который задаёт продавец: 1 единица базовой валюты = units_per_base единиц currency.
create table v4.fx_rates (
  bot_id uuid not null references v4.shops (bot_id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  units_per_base numeric(20, 8) not null check (units_per_base > 0),
  updated_at timestamptz not null default now(),
  primary key (bot_id, currency)
);

-- ── покупатель: одна запись, каналы отдельно (решения 68, 70) ────────────────
create table v4.buyers (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  name text,
  country text check (country ~ '^[A-Z]{2}$'),
  language text check (language in ('ru', 'kk', 'en', 'uz')),
  regular boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bot_id, id)
);

create table v4.buyer_channels (
  bot_id uuid not null,
  channel text not null check (channel in ('telegram', 'instagram', 'whatsapp', 'web')),
  external_id text not null check (external_id <> ''),
  buyer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (bot_id, channel, external_id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);

-- ── товары и цены по валютам (решение 91) ────────────────────────────────────
create table v4.products (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  title text not null check (title <> ''),
  kind text not null check (kind in ('file', 'club')),
  status text not null default 'active' check (status in ('active', 'archived')),
  base_price_minor bigint not null check (base_price_minor >= 0),
  created_at timestamptz not null default now(),
  unique (bot_id, id)
);

-- Своя цена товара в валюте (AATeach: цена в рублях задана руками).
create table v4.product_prices (
  bot_id uuid not null,
  product_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  primary key (product_id, currency),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);

-- ── способы оплаты по странам (решения 4, 5, 92, 53) ────────────────────────
-- transfer — перевод на реквизиты с чеком; country обязателен.
-- prodamus/apipay/robokassa — автооплаты; country null = любая страна.
-- fee_bp — комиссия платформы в сотых долях процента, только у автооплат.
create table v4.payment_methods (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  kind text not null check (kind in ('transfer', 'prodamus', 'apipay', 'robokassa')),
  country text check (country ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  details text not null default '',
  fee_bp integer not null default 0 check (fee_bp between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'transfer' or (country is not null and fee_bp = 0))
);
create index payment_methods_bot_country on v4.payment_methods (bot_id, country);

-- ── заказы ───────────────────────────────────────────────────────────────────
create table v4.order_counters (
  bot_id uuid primary key references v4.shops (bot_id),
  last_no bigint not null
);

create table v4.orders (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  no bigint not null,
  buyer_id uuid not null,
  country text check (country ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  points_used integer not null default 0 check (points_used >= 0),
  points_discount_minor bigint not null default 0 check (points_discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  status text not null default 'open' check (status in ('open', 'fulfilled', 'expired', 'cancelled')),
  close_reason text,
  is_test boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  closed_at timestamptz,
  unique (bot_id, no),
  unique (bot_id, id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  check (total_minor = subtotal_minor - points_discount_minor),
  check ((status in ('expired', 'cancelled')) = (close_reason is not null and closed_at is not null))
);
create index orders_bot_status_expires on v4.orders (bot_id, status, expires_at);
create index orders_buyer on v4.orders (bot_id, buyer_id, created_at desc);

create table v4.order_items (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  title text not null,
  price_minor bigint not null check (price_minor >= 0),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);
create index order_items_order on v4.order_items (order_id);

-- История заказа: каждое событие с суммой и номером платежа (CLAUDE.md «Деньги видны в журнале»).
create table v4.order_events (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in (
    'created', 'payment', 'paid', 'overpaid', 'payment_on_closed', 'currency_mismatch',
    'refund', 'chargeback', 'receipt_submitted', 'receipt_accepted', 'receipt_rejected',
    'expired', 'cancelled', 'fulfilled'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id)
);
create index order_events_order on v4.order_events (order_id, id);

-- ── счета платформы клиентам (решения 18, 32) ───────────────────────────────
-- Сумма = тариф минус явная скидка с причиной. Черновик подтверждает оператор.
create table v4.invoices (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  period date not null check (extract(day from period) = 1),
  tariff text not null,
  tariff_minor bigint not null check (tariff_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  discount_reason text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'void')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by text,
  unique (bot_id, id),
  check (discount_minor <= tariff_minor),
  check (discount_minor = 0 or coalesce(discount_reason, '') <> ''),
  check ((status = 'confirmed') = (confirmed_at is not null))
);
create unique index invoices_one_per_period on v4.invoices (bot_id, period) where status <> 'void';

-- ── книга денег ─────────────────────────────────────────────────────────────
-- book: sales — деньги покупателей продавцу; billing — оплаты клиента платформе.
-- kind и знак: payment, legacy_unconfirmed > 0; refund, chargeback, platform_fee < 0;
-- correction — любой знак, только встречной записью (reverses_id).
create table v4.ledger (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  book text not null default 'sales' check (book in ('sales', 'billing')),
  order_id uuid,
  invoice_id uuid,
  kind text not null check (kind in ('payment', 'legacy_unconfirmed', 'refund', 'chargeback', 'platform_fee', 'correction')),
  amount_minor bigint not null check (amount_minor <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('transfer', 'prodamus', 'apipay', 'robokassa', 'manual', 'legacy')),
  external_ref text not null check (external_ref <> ''),
  reverses_id bigint references v4.ledger (id),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (bot_id, method, external_ref),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  foreign key (bot_id, invoice_id) references v4.invoices (bot_id, id),
  check ((book = 'sales') = (invoice_id is null)),
  check (book = 'sales' or order_id is null),
  check (case kind
    when 'payment' then amount_minor > 0
    when 'legacy_unconfirmed' then amount_minor > 0
    when 'refund' then amount_minor < 0
    when 'chargeback' then amount_minor < 0
    when 'platform_fee' then amount_minor < 0
    else reverses_id is not null end)
);
create index ledger_order on v4.ledger (order_id) where order_id is not null;
create index ledger_bot_created on v4.ledger (bot_id, created_at);

-- ── чеки переводов (решения 3, 21, 55) ──────────────────────────────────────
create table v4.receipts (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  order_id uuid not null,
  storage_path text not null check (storage_path <> ''),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  suspicious_reason text,
  status text not null default 'waiting' check (status in ('waiting', 'accepted', 'rejected')),
  amount_minor bigint check (amount_minor > 0),
  reject_reason text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  purge_after timestamptz not null default now() + interval '1 year',
  purged_at timestamptz,
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check ((status = 'waiting') = (decided_at is null)),
  check (status <> 'accepted' or amount_minor is not null),
  check (status <> 'rejected' or coalesce(reject_reason, '') <> '')
);
create index receipts_waiting on v4.receipts (bot_id, submitted_at) where status = 'waiting';
create index receipts_fingerprint on v4.receipts (bot_id, fingerprint);

-- ── баллы (решение 93): 1 балл = 1 единица базовой валюты магазина ──────────
create table v4.points (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  buyer_id uuid not null,
  order_id uuid,
  kind text not null check (kind in ('earn', 'earn_reversal', 'redeem', 'redeem_return', 'migrated', 'adjust')),
  delta integer not null check (delta <> 0),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check (case kind
    when 'earn' then delta > 0
    when 'redeem_return' then delta > 0
    when 'migrated' then delta > 0
    when 'earn_reversal' then delta < 0
    when 'redeem' then delta < 0
    else true end)
);
create unique index points_once_per_order on v4.points (order_id, kind)
  where order_id is not null and kind in ('earn', 'earn_reversal', 'redeem', 'redeem_return');
create index points_buyer on v4.points (bot_id, buyer_id);

-- Книга и баллы только дописываются.
create or replace function v4.append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'v4:append_only',
    detail = tg_table_name || ': записи не меняются и не удаляются, ошибка исправляется встречной записью';
end $$;
create trigger ledger_append_only before update or delete on v4.ledger
  for each row execute function v4.append_only();
create trigger points_append_only before update or delete on v4.points
  for each row execute function v4.append_only();

-- ── расчёты ─────────────────────────────────────────────────────────────────

-- Оплачено по заказу в его валюте: платежи, старые «не подтверждено», минус возвраты и отмены.
create or replace function v4.order_paid_minor(p_order_id uuid, p_currency text) returns bigint
language sql stable as $$
  select coalesce(sum(amount_minor), 0)::bigint from v4.ledger
  where order_id = p_order_id and currency = p_currency
    and kind in ('payment', 'legacy_unconfirmed', 'refund', 'chargeback', 'correction')
$$;

create or replace function v4.points_balance(p_bot_id uuid, p_buyer_id uuid) returns integer
language sql stable as $$
  select coalesce(sum(delta), 0)::integer from v4.points where bot_id = p_bot_id and buyer_id = p_buyer_id
$$;

-- Курс базовой валюты к currency: 1 для самой базовой, null если продавец не задал.
create or replace function v4.rate(p_bot_id uuid, p_currency text) returns numeric
language sql stable as $$
  select case when s.base_currency = p_currency then 1::numeric
    else (select units_per_base from v4.fx_rates r where r.bot_id = p_bot_id and r.currency = p_currency) end
  from v4.shops s where s.bot_id = p_bot_id
$$;

-- Цена товара в валюте: своя цена → по курсу продавца (вверх до целой единицы) → null.
create or replace function v4.price_minor(p_bot_id uuid, p_product_id uuid, p_currency text) returns bigint
language sql stable as $$
  select coalesce(
    (select pp.amount_minor from v4.product_prices pp where pp.product_id = p.id and pp.currency = p_currency),
    (select (ceil(p.base_price_minor / 100.0 * v4.rate(p_bot_id, p_currency)) * 100)::bigint)
  )
  from v4.products p where p.id = p_product_id and p.bot_id = p_bot_id
$$;

-- Способы оплаты для страны покупателя (решение 4: бот говорит до цены, чем можно платить).
create or replace function v4.methods_for(p_bot_id uuid, p_country text)
returns setof v4.payment_methods language sql stable as $$
  select * from v4.payment_methods
  where bot_id = p_bot_id and active and (country = p_country or (country is null and kind <> 'transfer'))
  order by kind, id
$$;

-- ── операции ────────────────────────────────────────────────────────────────

-- Заказ. Валюта — страны покупателя, если все товары в ней оцениваются, иначе базовая.
-- p_points — сколько баллов списать (не больше баланса и % списания магазина).
create or replace function v4.create_order(
  p_bot_id uuid, p_buyer_id uuid, p_country text, p_product_ids uuid[],
  p_points integer default 0, p_is_test boolean default false, p_created_by text default 'bot'
) returns v4.orders language plpgsql as $$
declare
  s v4.shops;
  cur text;
  sub bigint := 0;
  pid uuid;
  pr bigint;
  rate numeric;
  disc bigint := 0;
  bal integer;
  o v4.orders;
  n bigint;
begin
  select * into s from v4.shops where bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:shop_not_found'; end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'v4:empty_order';
  end if;
  if exists (select 1 from unnest(p_product_ids) u(id)
             where not exists (select 1 from v4.products p
                               where p.id = u.id and p.bot_id = p_bot_id and p.status = 'active')) then
    raise exception using errcode = 'P0001', message = 'v4:product_unavailable';
  end if;

  cur := (select currency from v4.country_currency where country = p_country);
  if cur is null or exists (select 1 from unnest(p_product_ids) u(id)
                            where v4.price_minor(p_bot_id, u.id, cur) is null) then
    cur := s.base_currency;
  end if;
  foreach pid in array p_product_ids loop
    sub := sub + v4.price_minor(p_bot_id, pid, cur);
  end loop;

  if p_points < 0 then raise exception using errcode = 'P0001', message = 'v4:points_negative'; end if;
  if p_points > 0 then
    -- Блокировка покупателя: два заказа одновременно не спишут одни и те же баллы.
    perform 1 from v4.buyers where id = p_buyer_id and bot_id = p_bot_id for update;
    bal := v4.points_balance(p_bot_id, p_buyer_id);
    rate := v4.rate(p_bot_id, cur);
    if rate is null then raise exception using errcode = 'P0001', message = 'v4:points_no_rate'; end if;
    if p_points > bal then raise exception using errcode = 'P0001', message = 'v4:points_exceed_balance'; end if;
    disc := floor(p_points * rate * 100)::bigint;
    if disc > floor(sub * s.points_redeem_pct / 100) then
      raise exception using errcode = 'P0001', message = 'v4:points_exceed_limit';
    end if;
  end if;

  insert into v4.order_counters as c (bot_id, last_no) values (p_bot_id, 1)
    on conflict (bot_id) do update set last_no = c.last_no + 1
    returning last_no into n;

  insert into v4.orders (bot_id, no, buyer_id, country, currency, subtotal_minor, points_used,
                         points_discount_minor, total_minor, is_test, created_by)
  values (p_bot_id, n, p_buyer_id, p_country, cur, sub, p_points, disc, sub - disc, p_is_test, p_created_by)
  returning * into o;

  insert into v4.order_items (bot_id, order_id, product_id, title, price_minor)
  select p_bot_id, o.id, p.id, p.title, v4.price_minor(p_bot_id, p.id, cur)
  from unnest(p_product_ids) with ordinality u(id, i) join v4.products p on p.id = u.id order by u.i;

  if p_points > 0 then
    insert into v4.points (bot_id, buyer_id, order_id, kind, delta, created_by)
    values (p_bot_id, p_buyer_id, o.id, 'redeem', -p_points, p_created_by);
  end if;

  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'created',
          jsonb_build_object('total_minor', o.total_minor, 'currency', cur, 'points_used', p_points), p_created_by);
  return o;
end $$;

-- Платёж по заказу. Повтор с тем же (method, external_ref) возвращает ту же запись (duplicate).
-- Платёж принимается всегда: деньги пришли — они в книге, даже если заказ закрыт или валюта другая;
-- такие случаи помечаются флагами и событием, разбирает продавец (дело — этап 2).
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

  -- Комиссия платформы — только с автооплат (решение 53), отдельной строкой.
  if p_method in ('prodamus', 'apipay', 'robokassa') then
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
    -- Баллы за оплаченный заказ — один раз (уникальный индекс), только реальные деньги.
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

-- Возврат покупателю (решение 51): минус в книге, не больше оплаченного.
-- Если заказ перестал быть оплаченным — начисленные баллы снимаются (не ниже нуля).
create or replace function v4.refund(
  p_bot_id uuid, p_order_id uuid, p_amount_minor bigint, p_reason text,
  p_external_ref text, p_created_by text
) returns bigint language plpgsql as $$
declare
  o v4.orders;
  paid bigint;
  eid bigint;
  earned integer;
  bal integer;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if coalesce(p_reason, '') = '' then raise exception using errcode = 'P0001', message = 'v4:reason_required'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  select l.id into eid from v4.ledger l
  where l.bot_id = p_bot_id and l.method = 'manual' and l.external_ref = p_external_ref;
  if eid is not null then return eid; end if;

  paid := v4.order_paid_minor(o.id, o.currency);
  if p_amount_minor > paid then raise exception using errcode = 'P0001', message = 'v4:refund_exceeds_paid'; end if;

  insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, note, created_by)
  values (p_bot_id, o.id, 'refund', -p_amount_minor, o.currency, 'manual', p_external_ref, p_reason, p_created_by)
  returning id into eid;
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'refund', jsonb_build_object('entry_id', eid, 'amount_minor', p_amount_minor,
          'currency', o.currency, 'reason', p_reason), p_created_by);

  if paid - p_amount_minor < o.total_minor then
    perform 1 from v4.buyers where id = o.buyer_id and bot_id = p_bot_id for update;
    select delta into earned from v4.points where order_id = o.id and kind = 'earn';
    bal := v4.points_balance(p_bot_id, o.buyer_id);
    if earned is not null and least(earned, bal) > 0 then
      insert into v4.points (bot_id, buyer_id, order_id, kind, delta, note, created_by)
      values (p_bot_id, o.buyer_id, o.id, 'earn_reversal', -least(earned, bal), p_reason, p_created_by)
      on conflict do nothing;
    end if;
  end if;
  return eid;
end $$;

-- Отмена оплаты картой платёжкой (решение 54): минус в книге, повтор вебхука — та же запись.
create or replace function v4.record_chargeback(
  p_bot_id uuid, p_order_id uuid, p_amount_minor bigint, p_currency text,
  p_method text, p_external_ref text, p_created_by text
) returns bigint language plpgsql as $$
declare
  o v4.orders;
  eid bigint;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, created_by)
  values (p_bot_id, o.id, 'chargeback', -p_amount_minor, p_currency, p_method, 'chargeback:' || p_external_ref, p_created_by)
  on conflict (bot_id, method, external_ref) do nothing
  returning id into eid;
  if eid is null then
    select l.id into eid from v4.ledger l
    where l.bot_id = p_bot_id and l.method = p_method and l.external_ref = 'chargeback:' || p_external_ref;
    return eid;
  end if;
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'chargeback', jsonb_build_object('entry_id', eid, 'amount_minor', p_amount_minor,
          'currency', p_currency, 'method', p_method, 'external_ref', p_external_ref), p_created_by);
  return eid;
end $$;

-- Чек перевода. Тот же отпечаток уже был у этого продавца → пометка (решение 55), решает продавец.
-- p_hint — пометка из кода (например, картинку редактировали).
create or replace function v4.submit_receipt(
  p_bot_id uuid, p_order_id uuid, p_storage_path text, p_fingerprint text,
  p_hint text default null, p_created_by text default 'bot'
) returns v4.receipts language plpgsql as $$
declare
  o v4.orders;
  prev_no bigint;
  reason text := p_hint;
  r v4.receipts;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  select o2.no into prev_no from v4.receipts rc join v4.orders o2 on o2.id = rc.order_id
  where rc.bot_id = p_bot_id and rc.fingerprint = lower(p_fingerprint)
  order by rc.submitted_at, rc.id limit 1;
  if prev_no is not null then
    reason := concat_ws('; ', 'тот же чек уже был в заказе №' || prev_no, reason);
  end if;
  insert into v4.receipts (bot_id, order_id, storage_path, fingerprint, suspicious_reason)
  values (p_bot_id, o.id, p_storage_path, lower(p_fingerprint), reason)
  returning * into r;
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'receipt_submitted',
          jsonb_build_object('receipt_id', r.id, 'suspicious', reason), p_created_by);
  return r;
end $$;

-- Решение по чеку. Решает один (условие status = 'waiting'); принятый чек — платёж
-- с ключом receipt:<id>, поэтому второй клик не создаст второй платёж.
create or replace function v4.decide_receipt(
  p_bot_id uuid, p_receipt_id uuid, p_accept boolean, p_amount_minor bigint,
  p_reject_reason text, p_decided_by text
) returns table (decided boolean, status text, entry_id bigint, became_paid boolean)
language plpgsql as $$
declare
  r v4.receipts;
  o v4.orders;
  pay record;
begin
  if p_accept and coalesce(p_amount_minor, 0) <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  if not p_accept and coalesce(p_reject_reason, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:reason_required';
  end if;
  update v4.receipts rc set
    status = case when p_accept then 'accepted' else 'rejected' end,
    amount_minor = case when p_accept then p_amount_minor end,
    reject_reason = case when p_accept then null else p_reject_reason end,
    decided_at = now(), decided_by = p_decided_by
  where rc.id = p_receipt_id and rc.bot_id = p_bot_id and rc.status = 'waiting'
  returning * into r;
  if not found then
    select * into r from v4.receipts rc where rc.id = p_receipt_id and rc.bot_id = p_bot_id;
    if not found then raise exception using errcode = 'P0001', message = 'v4:receipt_not_found'; end if;
    return query select false, r.status, null::bigint, false;
    return;
  end if;
  select * into o from v4.orders where id = r.order_id;
  if p_accept then
    select * into pay from v4.record_payment(p_bot_id, r.order_id, p_amount_minor, o.currency,
                                             'transfer', 'receipt:' || r.id, p_decided_by);
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, r.order_id, 'receipt_accepted',
            jsonb_build_object('receipt_id', r.id, 'entry_id', pay.entry_id, 'amount_minor', p_amount_minor), p_decided_by);
    return query select true, r.status, pay.entry_id, pay.became_paid;
  else
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, r.order_id, 'receipt_rejected',
            jsonb_build_object('receipt_id', r.id, 'reason', p_reject_reason), p_decided_by);
    return query select true, r.status, null::bigint, false;
  end if;
end $$;

-- Закрыть заказ без оплаты: истёк (крон) или отменён (продавец/покупатель).
-- Ничего не удаляется; списанные баллы возвращаются один раз.
create or replace function v4.close_order(
  p_bot_id uuid, p_order_id uuid, p_status text, p_reason text, p_created_by text
) returns boolean language plpgsql as $$
declare
  o v4.orders;
begin
  if p_status not in ('expired', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'v4:bad_close_status';
  end if;
  if coalesce(p_reason, '') = '' then raise exception using errcode = 'P0001', message = 'v4:reason_required'; end if;
  update v4.orders set status = p_status, close_reason = p_reason, closed_at = now()
  where id = p_order_id and bot_id = p_bot_id and status = 'open'
  returning * into o;
  if not found then return false; end if;
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, p_status::text, jsonb_build_object('reason', p_reason), p_created_by);
  if o.points_used > 0 then
    insert into v4.points (bot_id, buyer_id, order_id, kind, delta, note, created_by)
    values (p_bot_id, o.buyer_id, o.id, 'redeem_return', o.points_used, p_reason, p_created_by)
    on conflict do nothing;
  end if;
  return true;
end $$;

-- Истечение через 7 дней (решение 2): только открытые, без денег и без чеков на проверке.
-- Частично оплаченные не истекают — по ним дело продавцу (этап 2).
create or replace function v4.expire_orders(p_bot_id uuid, p_now timestamptz default now())
returns integer language plpgsql as $$
declare
  v_id uuid;
  n integer := 0;
begin
  for v_id in
    select o.id from v4.orders o
    where o.bot_id = p_bot_id and o.status = 'open' and o.expires_at <= p_now
      and not exists (select 1 from v4.ledger l where l.order_id = o.id)
      and not exists (select 1 from v4.receipts r where r.order_id = o.id and r.status = 'waiting')
    order by o.id
  loop
    if v4.close_order(p_bot_id, v_id, 'expired', 'Не оплачен за 7 дней', 'cron') then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ── представления ──────────────────────────────────────────────────────────

-- Деньги по заказу: оплачено, долг, состояние. unconfirmed — есть старые суммы без подтверждения (решение 50).
create view v4.order_money with (security_invoker = true) as
select o.id as order_id, o.bot_id, o.no, o.currency, o.total_minor,
  v4.order_paid_minor(o.id, o.currency) as paid_minor,
  greatest(o.total_minor - v4.order_paid_minor(o.id, o.currency), 0) as due_minor,
  case
    when v4.order_paid_minor(o.id, o.currency) <= 0 then 'unpaid'
    when v4.order_paid_minor(o.id, o.currency) < o.total_minor then 'partial'
    when v4.order_paid_minor(o.id, o.currency) = o.total_minor then 'paid'
    else 'overpaid' end as money_state,
  exists (select 1 from v4.ledger l where l.order_id = o.id and l.kind = 'legacy_unconfirmed') as unconfirmed,
  exists (select 1 from v4.ledger l where l.order_id = o.id and l.currency <> o.currency) as other_currency,
  o.is_test
from v4.orders o;

-- Выписка по дням для налоговой (решение 52): суммы по дню магазина, валюте и виду. Пробные не входят (31).
create view v4.daily_totals with (security_invoker = true) as
select l.bot_id, l.book, (l.created_at at time zone s.timezone)::date as day, l.currency, l.kind,
  sum(l.amount_minor)::bigint as amount_minor, count(*)::bigint as entries
from v4.ledger l
join v4.shops s on s.bot_id = l.bot_id
left join v4.orders o on o.id = l.order_id
where not coalesce(o.is_test, false)
group by l.bot_id, l.book, (l.created_at at time zone s.timezone)::date, l.currency, l.kind;

create or replace function v4.money_of(p_bot_id uuid, p_order_id uuid)
returns setof v4.order_money language sql stable as $$
  select * from v4.order_money where bot_id = p_bot_id and order_id = p_order_id
$$;

-- ── права и изоляция ───────────────────────────────────────────────────────
alter table v4.country_currency enable row level security;
alter table v4.shops enable row level security;
alter table v4.fx_rates enable row level security;
alter table v4.buyers enable row level security;
alter table v4.buyer_channels enable row level security;
alter table v4.products enable row level security;
alter table v4.product_prices enable row level security;
alter table v4.payment_methods enable row level security;
alter table v4.order_counters enable row level security;
alter table v4.orders enable row level security;
alter table v4.order_items enable row level security;
alter table v4.order_events enable row level security;
alter table v4.invoices enable row level security;
alter table v4.ledger enable row level security;
alter table v4.receipts enable row level security;
alter table v4.points enable row level security;

create policy everyone_reads on v4.country_currency for select to tenant_bot using (true);
create policy own_shop on v4.shops for select to tenant_bot using (bot_id = v4.current_bot_id());
create policy own_shop_update on v4.shops for update to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy own_invoices on v4.invoices for select to tenant_bot using (bot_id = v4.current_bot_id());
create policy own_ledger_read on v4.ledger for select to tenant_bot using (bot_id = v4.current_bot_id());
create policy own_ledger_sales on v4.ledger for insert to tenant_bot
  with check (bot_id = v4.current_bot_id() and book = 'sales');

do $$
declare t text;
begin
  foreach t in array array['fx_rates', 'buyers', 'buyer_channels', 'products', 'product_prices',
    'payment_methods', 'order_counters', 'orders', 'order_items', 'order_events', 'receipts', 'points'] loop
    execute format('create policy tenant_isolation on v4.%I for all to tenant_bot
      using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id())', t);
  end loop;
end $$;

-- Ничего не удаляем (решение 2): delete нет ни у кого из ролей приложения.
revoke all on all tables in schema v4 from public, anon, authenticated, tenant_bot;
grant select, insert, update on all tables in schema v4 to service_role;
grant select on v4.country_currency, v4.shops, v4.invoices, v4.order_money, v4.daily_totals to tenant_bot;
grant update (points_earn_pct, points_redeem_pct, timezone) on v4.shops to tenant_bot;
grant select, insert, update on v4.fx_rates, v4.buyers, v4.buyer_channels, v4.products, v4.product_prices,
  v4.payment_methods, v4.order_counters to tenant_bot;
-- Суммы заказа и чека после создания не меняются: обновлять можно только статус и решение.
grant select, insert on v4.orders, v4.receipts to tenant_bot;
grant update (status, close_reason, closed_at) on v4.orders to tenant_bot;
grant update (status, amount_minor, reject_reason, decided_at, decided_by) on v4.receipts to tenant_bot;
grant select, insert on v4.order_items, v4.order_events, v4.ledger, v4.points to tenant_bot;
grant select on v4.order_money, v4.daily_totals to service_role;

revoke all on all functions in schema v4 from public, anon, authenticated;
grant execute on all functions in schema v4 to service_role, tenant_bot;

-- Проверка (должно вернуть 16 таблиц, 2 представления и 0 политик без RLS):
-- select count(*) filter (where c.relkind = 'r') as tables,
--        count(*) filter (where c.relkind = 'v') as views,
--        count(*) filter (where c.relkind = 'r' and not c.relrowsecurity) as without_rls
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'v4';
