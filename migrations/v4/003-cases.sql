-- v4/003: дела и сроки (этап 2; решения 3, 7, 14, 15, 28, 41–44, 54, 55, 66, 67).
-- Только схема v4. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- Главное:
--  * Дело — то, что кто-то должен сделать к сроку: проверить чек, ответить
--    покупателю, разобрать недоплату. У дела есть владелец (продавец, оператор,
--    бот) и срок. Открытое дело одного вида по одному поводу — одно (ключ).
--  * Сроки двигает v4.tick(): напомнить → передать оператору → вернуть боту.
--    Каждый шаг — условная запись по уровню, поэтому два тика одновременно
--    не напомнят дважды.
--  * Уведомления — очередь в базе с ключом «один раз». Срочное («now») уходит
--    сразу, остальное — в утреннюю сводку (решение 66). Отправку, которая могла
--    дойти, не повторяем: статус unknown.
--  * Очередь задач в базе вместо внешних кронов (решение 28): забирается с
--    `for update skip locked`, у каждой задачи аренда.

-- ── рабочие часы магазина (для «у продавца» со сроком, решение 7) ────────────
alter table v4.shops
  add column work_from smallint not null default 10 check (work_from between 0 and 23),
  add column work_to smallint not null default 19 check (work_to between 1 and 24),
  add column work_days smallint[] not null default '{1,2,3,4,5,6}',
  add constraint shops_work_hours check (work_from < work_to);

-- p_hours рабочих часов от p_from по часам и дням магазина (ISO: 1 = понедельник).
create or replace function v4.add_work_hours(p_bot_id uuid, p_from timestamptz, p_hours numeric)
returns timestamptz language plpgsql stable as $$
declare
  s v4.shops;
  t timestamp;          -- местное время магазина
  day_start timestamp;
  day_end timestamp;
  left_min numeric := p_hours * 60;
  avail numeric;
  i integer := 0;
begin
  select * into s from v4.shops where bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:shop_not_found'; end if;
  t := p_from at time zone s.timezone;
  loop
    i := i + 1;
    if i > 60 then raise exception using errcode = 'P0001', message = 'v4:no_work_hours'; end if;
    day_start := date_trunc('day', t) + make_interval(hours => s.work_from);
    day_end := date_trunc('day', t) + make_interval(hours => s.work_to);
    if extract(isodow from t)::smallint = any (s.work_days) and t < day_end then
      if t < day_start then t := day_start; end if;
      avail := extract(epoch from day_end - t) / 60;
      if left_min <= avail then
        return (t + make_interval(mins => ceil(left_min)::integer)) at time zone s.timezone;
      end if;
      left_min := left_min - avail;
    end if;
    t := date_trunc('day', t) + interval '1 day';
  end loop;
end $$;

-- ── дела ────────────────────────────────────────────────────────────────────
-- Правила сроков по видам — платформенный справочник (не про клиента).
-- first_* — первый срок; на нём владелец получает напоминание (remind) или дело
-- сразу уходит дальше. then_* — второй срок от открытия: кому передать.
-- work_hours — сроки считаются в рабочих часах магазина.
create table v4.case_policies (
  kind text primary key,
  owner text not null check (owner in ('seller', 'operator', 'bot')),
  first_after interval not null,
  first_action text not null check (first_action in ('remind', 'escalate', 'return_to_bot')),
  then_after interval,
  then_action text check (then_action in ('escalate', 'return_to_bot')),
  work_hours boolean not null default false,
  urgency text not null check (urgency in ('now', 'digest')),
  check ((then_after is null) = (then_action is null))
);
insert into v4.case_policies values
  -- чек ждёт: 2 ч — напоминание продавцу, 24 ч — оператору (решение 3)
  ('receipt_review',    'seller',   '2 hours',  'remind',        '24 hours', 'escalate',      false, 'now'),
  -- «у продавца»: после 4 рабочих часов диалог снова ведёт бот (решение 7)
  ('handoff',           'seller',   '4 hours',  'return_to_bot', null,       null,            true,  'now'),
  -- «не получается оплатить» (решение 41)
  ('cant_pay',          'seller',   '2 hours',  'remind',        '24 hours', 'escalate',      false, 'now'),
  -- недоплата: напомнить продавцу, через сутки — оператору
  ('underpaid',         'seller',   '24 hours', 'remind',        '72 hours', 'escalate',      false, 'digest'),
  ('payment_on_closed', 'seller',   '2 hours',  'remind',        '24 hours', 'escalate',      false, 'now'),
  ('currency_mismatch', 'seller',   '24 hours', 'remind',        '72 hours', 'escalate',      false, 'digest'),
  -- отмена оплаты картой (решение 54)
  ('chargeback',        'seller',   '24 hours', 'remind',        '72 hours', 'escalate',      false, 'now'),
  -- сбои выдачи и уведомлений (решение 43)
  ('delivery_failed',   'seller',   '2 hours',  'escalate',      null,       null,            false, 'now'),
  ('notify_failed',     'operator', '24 hours', 'remind',        null,       null,            false, 'digest'),
  -- ИИ-лимит кончился (решение 44)
  ('ai_limit',          'seller',   '24 hours', 'remind',        '72 hours', 'escalate',      false, 'now'),
  -- канал отключился: вопрос в течение часа (решение 42)
  ('channel_down',      'seller',   '1 hour',   'escalate',      null,       null,            false, 'now'),
  -- обращение продавца в платформу (решения 15, 25)
  ('seller_request',    'operator', '4 hours',  'remind',        null,       null,            true,  'now');

create table v4.cases (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  kind text not null references v4.case_policies (kind),
  dedupe_key text not null check (dedupe_key <> ''),
  status text not null default 'open' check (status in ('open', 'closed')),
  owner text not null check (owner in ('seller', 'operator', 'bot')),
  level smallint not null default 0 check (level between 0 and 2),
  due_at timestamptz,
  buyer_id uuid,
  order_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  close_note text,
  unique (bot_id, id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check ((status = 'closed') = (closed_at is not null and coalesce(close_note, '') <> ''))
);
create unique index cases_one_open on v4.cases (bot_id, kind, dedupe_key) where status = 'open';
create index cases_due on v4.cases (due_at) where status = 'open';
create index cases_buyer on v4.cases (bot_id, buyer_id, created_at desc);
create index cases_order on v4.cases (order_id) where order_id is not null;

create table v4.case_events (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  case_id uuid not null,
  kind text not null check (kind in ('opened', 'repeated', 'reminded', 'escalated', 'returned_to_bot', 'comment', 'closed')),
  detail jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (bot_id, case_id) references v4.cases (bot_id, id)
);
create index case_events_case on v4.case_events (case_id, id);

-- ── уведомления: очередь «один раз» (решения 66, 67) ─────────────────────────
create table v4.notifications (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  audience text not null check (audience in ('seller', 'operator', 'buyer')),
  urgency text not null check (urgency in ('now', 'digest')),
  kind text not null,
  dedupe_key text not null check (dedupe_key <> ''),
  case_id uuid,
  order_id uuid,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'unknown')),
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (bot_id, dedupe_key),
  foreign key (bot_id, case_id) references v4.cases (bot_id, id),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check ((status = 'sent') = (sent_at is not null))
);
create index notifications_queued on v4.notifications (urgency, created_at) where status = 'queued';

-- ── очередь задач (решение 28) ─────────────────────────────────────────────
create table v4.jobs (
  id bigint generated always as identity primary key,
  bot_id uuid,
  kind text not null check (kind ~ '^[a-z_]+$'),
  dedupe_key text not null check (dedupe_key <> ''),
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (kind, dedupe_key)
);
create index jobs_ready on v4.jobs (run_at) where status = 'queued';

-- ── функции дел ────────────────────────────────────────────────────────────

create or replace function v4.notify(
  p_bot_id uuid, p_audience text, p_urgency text, p_kind text, p_dedupe_key text,
  p_case_id uuid default null, p_order_id uuid default null, p_params jsonb default '{}'::jsonb
) returns boolean language plpgsql as $$
declare
  nid bigint;
begin
  insert into v4.notifications (bot_id, audience, urgency, kind, dedupe_key, case_id, order_id, params)
  values (p_bot_id, p_audience, p_urgency, p_kind, p_dedupe_key, p_case_id, p_order_id, p_params)
  on conflict (bot_id, dedupe_key) do nothing
  returning id into nid;
  return nid is not null;
end $$;

-- Открыть дело. Если такое же открыто — событие «повтор», второе дело не создаётся.
create or replace function v4.open_case(
  p_bot_id uuid, p_kind text, p_dedupe_key text, p_created_by text,
  p_buyer_id uuid default null, p_order_id uuid default null,
  p_detail jsonb default '{}'::jsonb, p_now timestamptz default now()
) returns table (case_id uuid, created boolean) language plpgsql as $$
declare
  pol v4.case_policies;
  cid uuid;
  due timestamptz;
begin
  select * into pol from v4.case_policies where kind = p_kind;
  if not found then raise exception using errcode = 'P0001', message = 'v4:unknown_case_kind'; end if;
  due := case when pol.work_hours
    then v4.add_work_hours(p_bot_id, p_now, extract(epoch from pol.first_after) / 3600)
    else p_now + pol.first_after end;
  insert into v4.cases (bot_id, kind, dedupe_key, owner, due_at, buyer_id, order_id, detail, created_by, created_at)
  values (p_bot_id, p_kind, p_dedupe_key, pol.owner, due, p_buyer_id, p_order_id, p_detail, p_created_by, p_now)
  on conflict (bot_id, kind, dedupe_key) where status = 'open' do nothing
  returning id into cid;
  if cid is null then
    select c.id into cid from v4.cases c
    where c.bot_id = p_bot_id and c.kind = p_kind and c.dedupe_key = p_dedupe_key and c.status = 'open';
    insert into v4.case_events (bot_id, case_id, kind, detail, created_by)
    values (p_bot_id, cid, 'repeated', p_detail, p_created_by);
    return query select cid, false;
    return;
  end if;
  insert into v4.case_events (bot_id, case_id, kind, detail, created_by)
  values (p_bot_id, cid, 'opened', p_detail, p_created_by);
  perform v4.notify(p_bot_id, pol.owner, pol.urgency, 'case_opened:' || p_kind, 'case:' || cid || ':opened',
                    cid, p_order_id, p_detail) where pol.owner <> 'bot';
  return query select cid, true;
end $$;

-- Закрыть дело (сделано). Второй вызов ничего не меняет.
create or replace function v4.close_case(p_bot_id uuid, p_case_id uuid, p_note text, p_created_by text)
returns boolean language plpgsql as $$
begin
  if coalesce(p_note, '') = '' then raise exception using errcode = 'P0001', message = 'v4:reason_required'; end if;
  update v4.cases set status = 'closed', closed_at = now(), close_note = p_note
  where id = p_case_id and bot_id = p_bot_id and status = 'open';
  if not found then return false; end if;
  insert into v4.case_events (bot_id, case_id, kind, detail, created_by)
  values (p_bot_id, p_case_id, 'closed', jsonb_build_object('note', p_note), p_created_by);
  return true;
end $$;

create or replace function v4.close_cases_for(
  p_bot_id uuid, p_kind text, p_dedupe_key text, p_note text, p_created_by text
) returns boolean language sql as $$
  select coalesce(bool_or(v4.close_case(p_bot_id, c.id, p_note, p_created_by)), false)
  from v4.cases c
  where c.bot_id = p_bot_id and c.kind = p_kind and c.dedupe_key = p_dedupe_key and c.status = 'open'
$$;

-- Бот отвечает покупателю, только если диалог не «у продавца» (решение 7).
create or replace function v4.bot_may_reply(p_bot_id uuid, p_buyer_id uuid) returns boolean
language sql stable as $$
  select not exists (select 1 from v4.cases c
    where c.bot_id = p_bot_id and c.buyer_id = p_buyer_id and c.kind = 'handoff' and c.status = 'open')
$$;

-- Сроки: один шаг на каждое просроченное дело. Условие на level — два тика не сделают шаг дважды.
create or replace function v4.tick_cases(p_now timestamptz default now())
returns integer language plpgsql as $$
declare
  c record;
  act text;
  n integer := 0;
  done boolean;
begin
  for c in
    select cs.*, p.first_action, p.then_after, p.then_action, p.work_hours, p.urgency
    from v4.cases cs join v4.case_policies p on p.kind = cs.kind
    where cs.status = 'open' and cs.due_at <= p_now
    order by cs.due_at, cs.id
    limit 500
  loop
    act := case c.level when 0 then c.first_action else c.then_action end;
    if act = 'remind' then
      update v4.cases set level = 1,
        due_at = case when c.then_after is null then null else c.created_at + c.then_after end
      where id = c.id and level = 0 and status = 'open';
      done := found;
      if done then
        insert into v4.case_events (bot_id, case_id, kind, created_by) values (c.bot_id, c.id, 'reminded', 'tick');
        perform v4.notify(c.bot_id, c.owner, 'now', 'case_reminder:' || c.kind, 'case:' || c.id || ':remind',
                          c.id, c.order_id, c.detail);
      end if;
    elsif act = 'escalate' then
      update v4.cases set level = 2, owner = 'operator', due_at = null
      where id = c.id and level = c.level and status = 'open';
      done := found;
      if done then
        insert into v4.case_events (bot_id, case_id, kind, detail, created_by)
        values (c.bot_id, c.id, 'escalated', jsonb_build_object('from', c.owner), 'tick');
        perform v4.notify(c.bot_id, 'operator', 'now', 'case_escalated:' || c.kind, 'case:' || c.id || ':escalate',
                          c.id, c.order_id, c.detail);
      end if;
    elsif act = 'return_to_bot' then
      update v4.cases set status = 'closed', closed_at = p_now, close_note = 'Срок продавца вышел, диалог снова ведёт бот'
      where id = c.id and level = c.level and status = 'open';
      done := found;
      if done then
        insert into v4.case_events (bot_id, case_id, kind, created_by) values (c.bot_id, c.id, 'returned_to_bot', 'tick');
        perform v4.notify(c.bot_id, 'seller', 'digest', 'handoff_returned', 'case:' || c.id || ':returned',
                          c.id, c.order_id, c.detail);
      end if;
    else
      -- шаг не задан: дело остаётся у владельца без срока
      update v4.cases set due_at = null where id = c.id and level = c.level and status = 'open';
      done := false;
    end if;
    if done then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Покупатель просит продавца: дело «у продавца» со сроком в рабочих часах.
create or replace function v4.hand_to_seller(
  p_bot_id uuid, p_buyer_id uuid, p_reason text, p_created_by text, p_now timestamptz default now()
) returns uuid language sql as $$
  select case_id from v4.open_case(p_bot_id, 'handoff', 'buyer:' || p_buyer_id, p_created_by,
                                   p_buyer_id, null, jsonb_build_object('reason', p_reason), p_now)
$$;

-- ── дела из событий заказа (связь с этапом 1) ─────────────────────────────
create or replace function v4.cases_from_order_event() returns trigger language plpgsql as $$
declare
  o v4.orders;
  m record;
begin
  select * into o from v4.orders where id = new.order_id;
  if o.is_test then return new; end if;
  case new.kind
    when 'receipt_submitted' then
      perform v4.open_case(new.bot_id, 'receipt_review', 'receipt:' || (new.detail ->> 'receipt_id'), new.created_by,
                           o.buyer_id, o.id, jsonb_build_object('order_no', o.no, 'receipt_id', new.detail ->> 'receipt_id',
                           'suspicious', new.detail -> 'suspicious'));
    when 'receipt_accepted', 'receipt_rejected' then
      perform v4.close_cases_for(new.bot_id, 'receipt_review', 'receipt:' || (new.detail ->> 'receipt_id'),
                                 case new.kind when 'receipt_accepted' then 'Чек принят' else 'Чек отклонён' end, new.created_by);
    when 'payment' then
      select * into m from v4.order_money where order_id = o.id;
      if m.money_state = 'partial' then
        perform v4.open_case(new.bot_id, 'underpaid', 'order:' || o.id, new.created_by, o.buyer_id, o.id,
                             jsonb_build_object('order_no', o.no, 'due_minor', m.due_minor, 'currency', o.currency));
      end if;
    when 'paid' then
      perform v4.close_cases_for(new.bot_id, 'underpaid', 'order:' || o.id, 'Заказ оплачен полностью', new.created_by);
      perform v4.close_cases_for(new.bot_id, 'cant_pay', 'buyer:' || o.buyer_id, 'Покупатель оплатил', new.created_by);
    when 'payment_on_closed' then
      perform v4.open_case(new.bot_id, 'payment_on_closed', 'order:' || o.id, new.created_by, o.buyer_id, o.id,
                           jsonb_build_object('order_no', o.no, 'status', new.detail ->> 'status'));
    when 'currency_mismatch' then
      perform v4.open_case(new.bot_id, 'currency_mismatch', 'order:' || o.id, new.created_by, o.buyer_id, o.id,
                           jsonb_build_object('order_no', o.no, 'order_currency', o.currency));
    when 'chargeback' then
      perform v4.open_case(new.bot_id, 'chargeback', 'order:' || o.id, new.created_by, o.buyer_id, o.id,
                           jsonb_build_object('order_no', o.no, 'amount_minor', new.detail -> 'amount_minor',
                           'currency', new.detail ->> 'currency'));
    else null;
  end case;
  return new;
end $$;
create trigger order_events_cases after insert on v4.order_events
  for each row execute function v4.cases_from_order_event();

-- ── уведомления и задачи: забрать и отметить ──────────────────────────────

-- Забрать срочные (или сводку) на отправку. Аренда 2 минуты; ничья аренда не перехватывается.
create or replace function v4.claim_notifications(
  p_urgency text, p_limit integer default 50, p_now timestamptz default now()
) returns setof v4.notifications language sql as $$
  update v4.notifications n set status = 'sending', lease_until = p_now + interval '2 minutes'
  where n.id in (
    select id from v4.notifications
    where status = 'queued' and urgency = p_urgency
    order by created_at, id
    limit p_limit
    for update skip locked
  )
  returning n.*
$$;

-- Итог отправки. unknown — обрыв, тайм-аут, 5xx: могло дойти, не повторяем (CLAUDE.md).
create or replace function v4.finish_notification(p_id bigint, p_status text, p_error text default null)
returns boolean language plpgsql as $$
begin
  if p_status not in ('sent', 'failed', 'unknown') then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  update v4.notifications set status = p_status, error = p_error, lease_until = null,
    sent_at = case when p_status = 'sent' then now() end
  where id = p_id and status = 'sending';
  return found;
end $$;

-- Аренда отправки истекла (функция упала посреди отправки): исход неизвестен, не повторяем.
create or replace function v4.expire_notification_leases(p_now timestamptz default now())
returns integer language sql as $$
  with x as (
    update v4.notifications set status = 'unknown', error = 'аренда отправки истекла', lease_until = null
    where status = 'sending' and lease_until < p_now
    returning 1
  ) select count(*)::integer from x
$$;

create or replace function v4.enqueue_job(
  p_kind text, p_dedupe_key text, p_bot_id uuid default null,
  p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default now()
) returns boolean language plpgsql as $$
declare
  jid bigint;
begin
  insert into v4.jobs (bot_id, kind, dedupe_key, payload, run_at)
  values (p_bot_id, p_kind, p_dedupe_key, p_payload, p_run_at)
  on conflict (kind, dedupe_key) do nothing
  returning id into jid;
  return jid is not null;
end $$;

-- Забрать готовые задачи. Упавшая по аренде задача снова в очереди, пока не кончатся попытки.
create or replace function v4.claim_jobs(
  p_limit integer default 20, p_lease interval default '2 minutes', p_now timestamptz default now()
) returns setof v4.jobs language plpgsql as $$
begin
  update v4.jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    last_error = 'аренда истекла', lease_until = null,
    done_at = case when attempts >= max_attempts then p_now end
  where status = 'running' and lease_until < p_now;
  return query
  update v4.jobs j set status = 'running', attempts = j.attempts + 1, lease_until = p_now + p_lease
  where j.id in (
    select id from v4.jobs
    where status = 'queued' and run_at <= p_now
    order by run_at, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;

create or replace function v4.finish_job(p_id bigint, p_ok boolean, p_error text default null, p_retry_in interval default '5 minutes')
returns boolean language plpgsql as $$
begin
  update v4.jobs set
    status = case when p_ok then 'done' when attempts >= max_attempts then 'failed' else 'queued' end,
    run_at = case when p_ok then run_at else now() + p_retry_in end,
    done_at = case when p_ok or attempts >= max_attempts then now() end,
    last_error = case when p_ok then null else p_error end,
    lease_until = null
  where id = p_id and status = 'running';
  return found;
end $$;

-- Один шаг планировщика: сроки дел, истечение заказов магазинов v4, зависшие отправки.
-- Вызывается раз в минуту (pg_cron или внешний крон); повторный вызов безопасен.
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
    'notifications_unknown', v4.expire_notification_leases(p_now));
end $$;

-- ── лента покупателя: заказы и дела рядом (решение 14) ────────────────────
create view v4.buyer_timeline with (security_invoker = true) as
select o.bot_id, o.buyer_id, e.created_at as at, 'order'::text as source, o.id as ref_id, o.no as order_no,
  e.kind, e.detail
from v4.order_events e join v4.orders o on o.id = e.order_id
union all
select c.bot_id, c.buyer_id, ce.created_at, 'case', c.id, null, c.kind || ':' || ce.kind, ce.detail
from v4.case_events ce join v4.cases c on c.id = ce.case_id
where c.buyer_id is not null;

-- Причины «не получается оплатить» по неделям (решение 41).
create view v4.cant_pay_reasons with (security_invoker = true) as
select bot_id, date_trunc('week', created_at)::date as week,
  coalesce(nullif(detail ->> 'reason', ''), 'не указана') as reason, count(*)::integer as cases
from v4.cases where kind = 'cant_pay'
group by 1, 2, 3;

-- ── права ──────────────────────────────────────────────────────────────────
alter table v4.case_policies enable row level security;
alter table v4.cases enable row level security;
alter table v4.case_events enable row level security;
alter table v4.notifications enable row level security;
alter table v4.jobs enable row level security;

create policy everyone_reads on v4.case_policies for select to tenant_bot using (true);
create policy tenant_isolation on v4.cases for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.case_events for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.notifications for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.case_policies, v4.cases, v4.case_events, v4.notifications, v4.jobs
  from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.case_policies, v4.cases, v4.case_events, v4.notifications, v4.jobs to service_role;
grant select on v4.case_policies, v4.buyer_timeline, v4.cant_pay_reasons to tenant_bot;
grant select on v4.buyer_timeline, v4.cant_pay_reasons to service_role;
grant select, insert on v4.cases, v4.case_events, v4.notifications to tenant_bot;
grant update (status, owner, level, due_at, closed_at, close_note) on v4.cases to tenant_bot;
-- Задачи и отправку уведомлений ведёт только сервисная роль (кроны по всем клиентам).

revoke all on all functions in schema v4 from public, anon, authenticated;
grant execute on all functions in schema v4 to service_role, tenant_bot;
revoke execute on function v4.tick(timestamptz), v4.tick_cases(timestamptz), v4.claim_notifications(text, integer, timestamptz),
  v4.finish_notification(bigint, text, text), v4.expire_notification_leases(timestamptz),
  v4.enqueue_job(text, text, uuid, jsonb, timestamptz), v4.claim_jobs(integer, interval, timestamptz),
  v4.finish_job(bigint, boolean, text, interval) from tenant_bot;

-- Проверка (должно вернуть 12 видов дел и 0 таблиц v4 без RLS):
-- select (select count(*) from v4.case_policies) as kinds,
--        (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--         where n.nspname = 'v4' and c.relkind = 'r' and not c.relrowsecurity) as without_rls;
