-- v4/027: замечания проверки. Только схема v4.
-- Бронь ИИ не уводит остаток в минус и входит в дневной предел.
-- Просроченные брони закрывает tick. Ход считает входящие своего режима.
-- Урок клуба получает позицию в базе. Ссылка на оплату держит отмену.
-- Заявка входящего снимается, если обработка сорвалась.

-- ── кошелёк: предел учитывает открытые брони ──────────────────────────────
create or replace function v4.ai_hold(
  p_bot_id uuid, p_amount_micro_usd bigint, p_purpose text, p_buyer_id uuid default null,
  p_daily_cap_micro_usd bigint default null, p_mode text default 'live', p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  w v4.ai_wallet;
  hid bigint;
  tz text;
  open_hold bigint;
begin
  if p_amount_micro_usd <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  w := v4.ai_wallet_lock(p_bot_id);
  select timezone into tz from v4.shops where bot_id = p_bot_id;
  select coalesce(sum(-l.amount_micro_usd), 0) into open_hold
    from v4.ai_ledger l
   where l.bot_id = p_bot_id and l.kind = 'hold'
     and not exists (select 1 from v4.ai_ledger c where c.hold_id = l.id);
  if p_daily_cap_micro_usd is not null
     and v4.ai_spent_today(p_bot_id, p_now) + open_hold + p_amount_micro_usd > p_daily_cap_micro_usd then
    perform v4.open_case(p_bot_id, 'ai_limit', 'day:' || to_char(p_now at time zone tz, 'YYYY-MM-DD'),
                         'ai', null, null, jsonb_build_object('cap_micro_usd', p_daily_cap_micro_usd), p_now);
    return jsonb_build_object('ok', false, 'reason', 'limit_day');
  end if;
  if w.balance_micro_usd < p_amount_micro_usd then
    if w.empty_at is null then
      update v4.ai_wallet set empty_at = p_now, updated_at = p_now where bot_id = p_bot_id;
    end if;
    perform v4.open_case(p_bot_id, 'ai_limit', 'empty:' || to_char(p_now at time zone tz, 'YYYY-MM-DD'),
                         'ai', null, null, jsonb_build_object('balance_micro_usd', w.balance_micro_usd), p_now);
    return jsonb_build_object('ok', false, 'reason', 'wallet_empty');
  end if;
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, expires_at, purpose, buyer_id, mode, created_by, created_at)
  values (p_bot_id, 'hold', -p_amount_micro_usd, p_now + interval '5 minutes', p_purpose, p_buyer_id, p_mode, 'ai', p_now)
  returning id into hid;
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd - p_amount_micro_usd, updated_at = p_now
  where bot_id = p_bot_id;
  return jsonb_build_object('ok', true, 'hold_id', hid);
end $$;

-- Расчёт не списывает больше, чем бронь и остаток: баланс не уходит ниже нуля.
create or replace function v4.ai_close_hold(
  p_bot_id uuid, p_hold_id bigint, p_kind text, p_api_micro_usd bigint, p_markup_bp integer,
  p_created_by text, p_now timestamptz
) returns bigint language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  h v4.ai_ledger;
  total bigint := 0;
  delta bigint;
  w v4.ai_wallet;
  avail bigint;
begin
  w := v4.ai_wallet_lock(p_bot_id);
  select * into h from v4.ai_ledger where id = p_hold_id and bot_id = p_bot_id and kind = 'hold';
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if exists (select 1 from v4.ai_ledger where hold_id = p_hold_id) then
    raise exception using errcode = 'P0001', message = 'v4:append_only';
  end if;
  avail := w.balance_micro_usd + (-h.amount_micro_usd);
  if p_kind = 'settle' then
    total := (greatest(p_api_micro_usd, 0) * (10000 + p_markup_bp) + 9999) / 10000;
    if total > avail then total := greatest(avail, 0); end if;
  end if;
  delta := -h.amount_micro_usd - total;
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, api_micro_usd, markup_bp, total_micro_usd,
                            hold_id, purpose, buyer_id, mode, created_by, created_at)
  values (p_bot_id, p_kind, delta,
          case when p_kind = 'settle' then greatest(p_api_micro_usd, 0) end,
          case when p_kind = 'settle' then p_markup_bp end,
          case when p_kind = 'settle' then total end,
          p_hold_id, h.purpose, h.buyer_id, h.mode, p_created_by, p_now);
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd + delta,
    low_at = case when balance_micro_usd + delta <= 1000000 and low_at is null then p_now else low_at end,
    empty_at = case when balance_micro_usd + delta <= 0 and empty_at is null then p_now else empty_at end,
    updated_at = p_now
  where bot_id = p_bot_id;
  return total;
end $$;

-- Цену расчёта передаёт только сервисная роль.
revoke execute on function
  v4.ai_settle(uuid, bigint, bigint, integer, timestamptz),
  v4.ai_release(uuid, bigint, timestamptz)
  from tenant_bot;

-- ── ход своего режима ──────────────────────────────────────────────────────
drop function if exists v4.release_turn(uuid, uuid, uuid, bigint);

create function v4.release_turn(
  p_bot_id uuid, p_buyer_id uuid, p_turn_id uuid, p_after_message_id bigint,
  p_mode text default 'live'
) returns bigint language plpgsql as $$
declare
  pending bigint;
begin
  perform 1 from v4.buyers where bot_id = p_bot_id and id = p_buyer_id for update;
  select count(*) into pending from v4.messages m
  where m.bot_id = p_bot_id and m.buyer_id = p_buyer_id and m.direction = 'in'
    and m.mode = p_mode and m.id > p_after_message_id;
  if pending = 0 then
    update v4.buyers set turn_id = null, turn_until = null
    where bot_id = p_bot_id and id = p_buyer_id and turn_id = p_turn_id;
  end if;
  return pending;
end $$;

revoke all on function v4.release_turn(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function v4.release_turn(uuid, uuid, uuid, bigint, text)
  to service_role, tenant_bot;

-- ── заявка входящего снимается при сбое ───────────────────────────────────
create or replace function v4.release_inbound(p_bot_id uuid, p_channel text, p_external_id text)
returns void language sql as $$
  delete from v4.inbound_claims
   where bot_id = p_bot_id and channel = p_channel and external_id = p_external_id
$$;

revoke all on function v4.release_inbound(uuid, text, text) from public, anon, authenticated;
grant execute on function v4.release_inbound(uuid, text, text) to service_role, tenant_bot;

-- ── урок: следующая позиция под блокировкой товара ─────────────────────────
create or replace function v4.append_lesson(p_bot_id uuid, p_product_id uuid, p_title text)
returns uuid language plpgsql as $$
declare
  lid uuid;
  pos integer;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  perform 1 from v4.products
   where id = p_product_id and bot_id = p_bot_id and kind = 'club'
   for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  select coalesce(max("position"), 0) + 1 into pos from v4.lessons where product_id = p_product_id;
  insert into v4.lessons (bot_id, product_id, title, position)
  values (p_bot_id, p_product_id, btrim(p_title), pos)
  returning id into lid;
  return lid;
end $$;

revoke all on function v4.append_lesson(uuid, uuid, text) from public, anon, authenticated;
grant execute on function v4.append_lesson(uuid, uuid, text) to service_role, tenant_bot;

-- ── ссылка на оплату держит отмену, пока не истекла ───────────────────────
create table v4.pay_links (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  order_id uuid not null references v4.orders (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table v4.pay_links enable row level security;
create policy tenant_isolation on v4.pay_links for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
revoke all on v4.pay_links from public, anon, authenticated, tenant_bot;
grant select, insert on v4.pay_links to service_role, tenant_bot;

create or replace function v4.issue_pay_link(
  p_bot_id uuid, p_order_id uuid, p_expires_at timestamptz
) returns uuid language plpgsql as $$
declare
  lid uuid;
begin
  if not exists (select 1 from v4.orders where id = p_order_id and bot_id = p_bot_id and status = 'open') then
    raise exception using errcode = 'P0001', message = 'v4:order_not_found';
  end if;
  if p_expires_at is null then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  insert into v4.pay_links (bot_id, order_id, expires_at)
  values (p_bot_id, p_order_id, p_expires_at)
  returning id into lid;
  return lid;
end $$;

revoke all on function v4.issue_pay_link(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function v4.issue_pay_link(uuid, uuid, timestamptz) to service_role, tenant_bot;

create or replace function v4.cancel_by_buyer(p_bot_id uuid, p_buyer_id uuid, p_order_no bigint)
returns text language plpgsql as $$
declare
  o v4.orders;
begin
  select * into o from v4.orders where bot_id = p_bot_id and no = p_order_no for update;
  if not found or o.buyer_id <> p_buyer_id then return 'not_yours'; end if;
  if o.status <> 'open' then return 'not_open'; end if;
  if exists (select 1 from v4.ledger l where l.order_id = o.id) then return 'paid'; end if;
  if exists (select 1 from v4.receipts r where r.order_id = o.id and r.status = 'waiting') then
    return 'receipt_waiting';
  end if;
  if exists (
    select 1 from v4.pay_links k
    where k.bot_id = p_bot_id and k.order_id = o.id and k.expires_at > now()
  ) then
    return 'link_open';
  end if;
  if not v4.close_order(p_bot_id, o.id, 'cancelled', 'Отменил покупатель в чате', 'buyer') then
    return 'not_open';
  end if;
  return 'ok';
end $$;

-- ── входящее без ответа старше 10 минут — дело продавцу ───────────────────
create or replace function v4.sweep_unanswered(p_now timestamptz default now())
returns integer language plpgsql as $$
declare
  m record;
  n integer := 0;
begin
  for m in
    select distinct on (i.bot_id, i.buyer_id) i.bot_id, i.buyer_id, i.id
    from v4.messages i
    join v4.buyers b on b.bot_id = i.bot_id and b.id = i.buyer_id
    where i.direction = 'in'
      and i.created_at <= p_now - interval '10 minutes'
      and (b.turn_until is null or b.turn_until <= p_now)
      and not exists (
        select 1 from v4.messages o
        where o.bot_id = i.bot_id and o.buyer_id = i.buyer_id
          and o.direction = 'out' and o.id > i.id
      )
    order by i.bot_id, i.buyer_id, i.id
  loop
    perform v4.open_case(m.bot_id, 'handoff', 'unanswered:' || m.id::text, 'tick',
                         m.buyer_id, null, jsonb_build_object('message_id', m.id), p_now);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function v4.sweep_unanswered(timestamptz) from public, anon, authenticated;
grant execute on function v4.sweep_unanswered(timestamptz) to service_role;

create or replace function v4.tick(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  expired integer := 0;
  s record;
begin
  for s in select bot_id from v4.shops order by bot_id loop
    expired := expired + v4.expire_orders(s.bot_id, p_now);
  end loop;
  return jsonb_build_object(
    'cases', v4.tick_cases(p_now),
    'orders_expired', expired,
    'access', v4.expire_access(p_now),
    'notifications_unknown', v4.expire_notification_leases(p_now),
    'holds_expired', v4.ai_expire_holds(p_now),
    'unanswered', v4.sweep_unanswered(p_now));
end $$;

-- Валюта заказа для кассы, которая не присылает её сама.
create or replace function v4.order_currency(p_bot_id uuid, p_order_id uuid)
returns text language sql stable as $$
  select currency from v4.orders where bot_id = p_bot_id and id = p_order_id
$$;

revoke all on function v4.order_currency(uuid, uuid) from public, anon, authenticated;
grant execute on function v4.order_currency(uuid, uuid) to service_role, tenant_bot;

-- Проверка (должно вернуть 4 функции и таблицу ссылок):
-- select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'v4' and p.proname in
--            ('append_lesson', 'issue_pay_link', 'release_inbound', 'sweep_unanswered')) as fns,
--        (select count(*) from pg_tables where schemaname = 'v4' and tablename = 'pay_links') as links;
