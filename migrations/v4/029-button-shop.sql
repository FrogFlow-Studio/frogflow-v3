-- v4/029: магазин на кнопках. Карточка живёт в коде; здесь воронка, обе валюты,
-- возврат закрывает доступ, остаток возвращается один раз, дата выдачи и окно Instagram.

alter table v4.stock_moves drop constraint stock_moves_reason_check;
alter table v4.stock_moves add constraint stock_moves_reason_check
  check (reason in ('receipt', 'sale', 'writeoff', 'stocktake', 'return'));

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
  if p_reason not in ('receipt', 'sale', 'writeoff', 'stocktake', 'return')
     or p_delta is null or p_delta = 0 then
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

-- Отмена и истечение возвращают списанный остаток один раз: ключ return:<позиция>.
create or replace function v4.return_stock_on_close() returns trigger
language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  item record;
begin
  if new.kind not in ('cancelled', 'expired') then return new; end if;
  for item in
    select oi.id, oi.product_id
    from v4.order_items oi
    join v4.products p on p.id = oi.product_id and p.bot_id = oi.bot_id
    where oi.order_id = new.order_id and oi.bot_id = new.bot_id and p.track_stock
  loop
    perform v4.move_stock(new.bot_id, item.product_id, 1, 'return', 'return:' || item.id::text, new.created_by);
  end loop;
  return new;
end $$;

create trigger order_events_return_stock after insert on v4.order_events
  for each row execute function v4.return_stock_on_close();

-- Возврат, после которого заказ больше не оплачен, снимает доступ и клуб.
create or replace function v4.revoke_access_when_unpaid() returns trigger
language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  o v4.orders;
  a record;
begin
  if new.kind <> 'refund' then return new; end if;
  select * into o from v4.orders where id = new.order_id and bot_id = new.bot_id;
  if not found then return new; end if;
  if v4.order_paid_minor(o.id, o.currency) >= o.total_minor then return new; end if;
  for a in
    select id from v4.access
    where order_id = o.id and bot_id = o.bot_id and status = 'active'
  loop
    perform v4.revoke_access(o.bot_id, a.id, coalesce(new.detail->>'reason', 'refund'), new.created_by);
  end loop;
  return new;
end $$;

create trigger order_events_refund_access after insert on v4.order_events
  for each row execute function v4.revoke_access_when_unpaid();

-- Два сохранения урока подряд не получают один номер: занятая позиция сдвигается.
create or replace function v4.add_lesson(
  p_bot_id uuid, p_product_id uuid, p_title text, p_position integer
) returns uuid language plpgsql as $$
declare
  lid uuid;
  pos integer;
begin
  if not exists (select 1 from v4.products where id = p_product_id and bot_id = p_bot_id and kind = 'club') then
    raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  if coalesce(p_title, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status'; end if;
  perform 1 from v4.products where id = p_product_id and bot_id = p_bot_id for update;
  pos := p_position;
  if pos is null or pos <= 0 or exists (
    select 1 from v4.lessons where product_id = p_product_id and position = pos
  ) then
    select coalesce(max(position), 0) + 1 into pos from v4.lessons where product_id = p_product_id;
  end if;
  insert into v4.lessons (bot_id, product_id, title, position)
  values (p_bot_id, p_product_id, p_title, pos)
  returning id into lid;
  return lid;
end $$;

alter table v4.orders
  add column fulfill_on date,
  add column fulfill_zone text,
  add column fulfill_address text,
  add column flower jsonb;

create or replace function v4.set_fulfillment(
  p_bot_id uuid, p_order_id uuid, p_on date, p_zone text, p_address text, p_flower jsonb default null
) returns boolean language plpgsql as $$
begin
  update v4.orders set
    fulfill_on = p_on,
    fulfill_zone = p_zone,
    fulfill_address = p_address,
    flower = p_flower
  where id = p_order_id and bot_id = p_bot_id;
  return found;
end $$;

-- Напоминание за сутки покупателю и продавцу. Повтор крона не двоит: ключ уведомления.
create or replace function v4.remind_physical(p_bot_id uuid, p_now timestamptz default now())
returns integer language plpgsql as $$
declare
  tz text;
  due date;
  o record;
  n integer := 0;
begin
  select timezone into tz from v4.shops where bot_id = p_bot_id;
  due := ((p_now at time zone coalesce(tz, 'Asia/Almaty'))::date + 1);
  for o in
    select id, buyer_id from v4.orders
    where bot_id = p_bot_id and status = 'open' and fulfill_on = due
    order by id
  loop
    if v4.notify(p_bot_id, 'buyer', 'now', 'fulfill_remind', 'fulfill_remind:buyer:' || o.id,
                 null, o.id, jsonb_build_object('buyer_id', o.buyer_id, 'on', due)) then
      n := n + 1;
    end if;
    if v4.notify(p_bot_id, 'seller', 'now', 'fulfill_remind', 'fulfill_remind:seller:' || o.id,
                 null, o.id, jsonb_build_object('on', due)) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Instagram, как WhatsApp: за краем 24 часов вторую отправку не выдумываем.
create or replace function v4.reply_window_open(
  p_bot_id uuid, p_channel text, p_external_id text, p_now timestamptz default now()
) returns boolean language sql stable as $$
  select case
    when p_channel not in ('whatsapp', 'instagram') then true
    else exists (
      select 1 from v4.buyer_channels c
      where c.bot_id = p_bot_id and c.channel = p_channel and c.external_id = p_external_id
        and c.last_inbound_at is not null and c.last_inbound_at > p_now - interval '24 hours')
  end
$$;

-- Суммы книги по валютам: валюта заказа и чужая не прячутся друг в друга.
create or replace function v4.money_lines(p_bot_id uuid, p_order_id uuid)
returns table (currency text, amount_minor bigint, order_currency boolean)
language sql stable as $$
  select l.currency, sum(l.amount_minor)::bigint, l.currency = o.currency
  from v4.ledger l
  join v4.orders o on o.id = l.order_id and o.bot_id = l.bot_id
  where l.bot_id = p_bot_id and l.order_id = p_order_id and l.book = 'sales'
  group by l.currency, o.currency
  having sum(l.amount_minor) <> 0
$$;

-- ── воронка: список шагов, не холст ─────────────────────────────────────────
create table v4.funnels (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  name text not null check (name <> ''),
  trigger_kind text not null check (trigger_kind in ('start', 'keyword', 'button', 'comment', 'story', 'broadcast')),
  trigger_value text not null default '',
  rev integer not null default 1 check (rev > 0),
  created_at timestamptz not null default now(),
  unique (bot_id, trigger_kind, trigger_value)
);

create table v4.funnel_steps (
  funnel_id uuid not null references v4.funnels (id) on delete cascade,
  bot_id uuid not null,
  position integer not null check (position > 0),
  kind text not null check (kind in ('card', 'wait', 'branch', 'case')),
  payload jsonb not null default '{}'::jsonb,
  primary key (funnel_id, position)
);

create table v4.funnel_sends (
  bot_id uuid not null,
  external_ref text not null check (external_ref <> ''),
  funnel_id uuid not null references v4.funnels (id),
  created_at timestamptz not null default now(),
  primary key (bot_id, external_ref)
);

create or replace function v4.save_funnel(
  p_bot_id uuid, p_name text, p_trigger_kind text, p_trigger_value text, p_steps jsonb,
  p_funnel_id uuid default null, p_rev integer default null
) returns jsonb language plpgsql as $$
declare
  fid uuid;
  cur integer;
  i integer := 0;
  step jsonb;
  wrote integer;
begin
  if p_trigger_kind not in ('start', 'keyword', 'button', 'comment', 'story', 'broadcast')
     or coalesce(p_name, '') = '' or jsonb_typeof(p_steps) <> 'array' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_funnel_id is null then
    insert into v4.funnels (bot_id, name, trigger_kind, trigger_value)
    values (p_bot_id, p_name, p_trigger_kind, coalesce(p_trigger_value, ''))
    returning id, rev into fid, cur;
  else
    update v4.funnels set
      name = p_name,
      trigger_kind = p_trigger_kind,
      trigger_value = coalesce(p_trigger_value, ''),
      rev = rev + 1
    where id = p_funnel_id and bot_id = p_bot_id and rev = p_rev
    returning id, rev into fid, cur;
    get diagnostics wrote = row_count;
    if wrote = 0 then
      select rev into cur from v4.funnels where id = p_funnel_id and bot_id = p_bot_id;
      if cur is null then raise exception using errcode = 'P0001', message = 'v4:not_found'; end if;
      return jsonb_build_object('id', p_funnel_id, 'rev', cur, 'saved', false);
    end if;
    delete from v4.funnel_steps where funnel_id = fid and bot_id = p_bot_id;
  end if;
  for step in select value from jsonb_array_elements(p_steps) loop
    i := i + 1;
    if coalesce(step->>'kind', '') not in ('card', 'wait', 'branch', 'case') then
      raise exception using errcode = 'P0001', message = 'v4:bad_status';
    end if;
    insert into v4.funnel_steps (funnel_id, bot_id, position, kind, payload)
    values (fid, p_bot_id, i, step->>'kind', coalesce(step->'payload', '{}'::jsonb));
  end loop;
  return jsonb_build_object('id', fid, 'rev', cur, 'saved', true, 'steps', i);
end $$;

create or replace function v4.list_funnels(p_bot_id uuid)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.name, f.id), '[]'::jsonb)
  from (
    select n.id, n.name, n.trigger_kind, n.trigger_value, n.rev,
      coalesce((
        select jsonb_agg(jsonb_build_object('position', s.position, 'kind', s.kind, 'payload', s.payload)
                         order by s.position)
        from v4.funnel_steps s where s.funnel_id = n.id
      ), '[]'::jsonb) as steps
    from v4.funnels n
    where n.bot_id = p_bot_id
  ) f
$$;

-- Отметку «ушло» ставит вставка до отправки. Повтор — false, второе сообщение не шлём.
create or replace function v4.claim_funnel_send(p_bot_id uuid, p_funnel_id uuid, p_external_ref text)
returns boolean language plpgsql as $$
declare
  wrote integer;
begin
  if coalesce(p_external_ref, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  perform 1 from v4.funnels where id = p_funnel_id and bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:not_found'; end if;
  insert into v4.funnel_sends (bot_id, external_ref, funnel_id)
  values (p_bot_id, p_external_ref, p_funnel_id)
  on conflict (bot_id, external_ref) do nothing;
  get diagnostics wrote = row_count;
  return wrote = 1;
end $$;

alter table v4.funnels enable row level security;
alter table v4.funnel_steps enable row level security;
alter table v4.funnel_sends enable row level security;

create policy tenant_isolation on v4.funnels for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.funnel_steps for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.funnel_sends for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.funnels, v4.funnel_steps, v4.funnel_sends
  from public, anon, authenticated, tenant_bot;
grant update (fulfill_on, fulfill_zone, fulfill_address, flower) on v4.orders to tenant_bot;
grant select, insert, update, delete on v4.funnels, v4.funnel_steps to service_role, tenant_bot;
grant select, insert on v4.funnel_sends to service_role, tenant_bot;

revoke all on function
  v4.set_fulfillment(uuid, uuid, date, text, text, jsonb),
  v4.remind_physical(uuid, timestamptz),
  v4.money_lines(uuid, uuid),
  v4.save_funnel(uuid, text, text, text, jsonb, uuid, integer),
  v4.list_funnels(uuid),
  v4.claim_funnel_send(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  v4.set_fulfillment(uuid, uuid, date, text, text, jsonb),
  v4.remind_physical(uuid, timestamptz),
  v4.money_lines(uuid, uuid),
  v4.save_funnel(uuid, text, text, text, jsonb, uuid, integer),
  v4.list_funnels(uuid),
  v4.claim_funnel_send(uuid, uuid, text)
  to service_role, tenant_bot;

-- Проверка (должна вернуть 3 таблицы и причину return):
-- select (select count(*) from information_schema.tables where table_schema = 'v4'
--           and table_name in ('funnels','funnel_steps','funnel_sends')) as tables,
--        (select pg_get_constraintdef(oid) from pg_constraint
--          where conname = 'stock_moves_reason_check') as stock_reason;
