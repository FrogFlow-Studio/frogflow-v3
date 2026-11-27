-- v4/023: ИИ-продавец — польза, учёба, право, сигналы (этап 1 «Мозг магазина»,
-- расширение Р8, Р9, В4 и наблюдаемость). Только схема v4. Применяет Яков после 022.
--
-- Главное:
--  * Р8: ответ продавца на передачу (learn_from_reply) — ещё и «кандидат в
--    экзамен»: строка exam_candidates, одна на дело.
--  * Р9: ai_value_report — сколько ИИ стоил и что принёс за период: ответы,
--    простые ответы, передачи, предложения, нажатия, оплаченные заказы и выручка
--    по валютам, цена одного оплаченного заказа.
--  * В4: forget_buyer — обезличить покупателя по его просьбе: имя, почта, тексты
--    сообщений, факты и внешние id стираются; заказы и деньги остаются с пустым
--    покупателем (решение 2 «ничего не удаляем» — про деньги и дела).
--  * Сигналы оператору (дело ai_health, одно в час на причину): простых ответов
--    больше 10 % за час (не меньше 10 ответов), 3 сбоя модели за 10 минут,
--    расхождение кошелька с книгой (раз в сутки).

-- ── Р8: кандидаты в экзамен ─────────────────────────────────────────────────
create table v4.exam_candidates (
  id bigint generated always as identity primary key,
  bot_id uuid not null references v4.shops (bot_id),
  case_id uuid not null,
  knowledge_id uuid,
  buyer_id uuid,
  question text not null check (length(question) between 1 and 1000),
  answer text not null check (length(answer) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (bot_id, case_id) references v4.cases (bot_id, id)
);
create unique index exam_candidates_once on v4.exam_candidates (case_id);

create or replace function v4.learn_from_reply(
  p_bot_id uuid, p_case_id uuid, p_question text, p_answer text,
  p_product_id uuid default null, p_created_by text default 'seller'
) returns uuid language plpgsql as $$
declare
  kid uuid;
begin
  insert into v4.knowledge (bot_id, product_id, question, answer, source, case_id, created_by, needs_review)
  values (p_bot_id, p_product_id, p_question, p_answer, 'seller_reply', p_case_id, p_created_by,
          v4.knowledge_risky(p_answer))
  on conflict (case_id) where case_id is not null do nothing
  returning id into kid;
  perform v4.close_case(p_bot_id, p_case_id, 'Продавец ответил, ответ сохранён в знания', p_created_by);
  if kid is null then
    select id into kid from v4.knowledge where case_id = p_case_id;
  end if;
  -- Р8: передача, на которую ответил продавец, — кандидат в экзамен (один раз на дело).
  insert into v4.exam_candidates (bot_id, case_id, knowledge_id, buyer_id, question, answer)
  select p_bot_id, p_case_id, kid, c.buyer_id, left(p_question, 1000), left(p_answer, 4000)
  from v4.cases c where c.bot_id = p_bot_id and c.id = p_case_id
  on conflict (case_id) do nothing;
  return kid;
end $$;

-- ── Р9: что ИИ стоил и что принёс ──────────────────────────────────────────
-- Только боевой режим. «Принёс» — заказы из нажатых предложений бота; оплата —
-- по книге денег (order_paid_minor), по валюте заказа.
create or replace function v4.ai_value_report(p_bot_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable as $$
  with m as (
    select * from v4.messages
    where bot_id = p_bot_id and mode = 'live' and direction = 'out' and author = 'bot'
      and created_at >= p_from and created_at < p_to),
  o as (
    select * from v4.offers
    where bot_id = p_bot_id and mode = 'live' and created_at >= p_from and created_at < p_to),
  ord as (
    select distinct r.id, r.currency, r.total_minor, v4.order_paid_minor(r.id, r.currency) as paid_minor
    from o join v4.orders r on r.bot_id = o.bot_id and r.id = o.order_id
    where o.order_id is not null),
  paid as (select * from ord where paid_minor > 0)
  select jsonb_build_object(
    'replies_model', (select count(*) from m where source = 'model'),
    'replies_simple', (select count(*) from m where source = 'fallback' and reason is not null),
    'spent_micro_usd', (select coalesce(sum(cost_micro_usd), 0) from m),
    'handoffs', (select count(*) from m, jsonb_array_elements(m.actions) a where a ->> 'kind' = 'handoff'),
    'offers_shown', (select count(*) from o),
    'offers_pressed', (select count(*) from o where order_id is not null),
    'orders_paid', (select count(*) from paid),
    'revenue_minor', coalesce((select jsonb_object_agg(currency, s) from (
      select currency, sum(least(paid_minor, total_minor)) s from paid group by currency) x), '{}'::jsonb),
    'cost_per_paid_order_micro_usd', case when (select count(*) from paid) > 0
      then (select coalesce(sum(cost_micro_usd), 0) from m) / (select count(*) from paid) end)
$$;

-- ── В4: обезличить покупателя по просьбе ───────────────────────────────────
alter table v4.buyers add column forgotten_at timestamptz;

create or replace function v4.forget_buyer(
  p_bot_id uuid, p_buyer_id uuid, p_by text, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = v4, pg_temp as $$
begin
  if v4.current_bot_id() is not null and v4.current_bot_id() <> p_bot_id then
    raise exception using errcode = 'P0001', message = 'v4:foreign_bot';
  end if;
  update v4.buyers set name = null, email = null, forgotten_at = coalesce(forgotten_at, p_now)
  where bot_id = p_bot_id and id = p_buyer_id;
  if not found then return false; end if;
  update v4.messages set text = '', external_id = null
  where bot_id = p_bot_id and buyer_id = p_buyer_id and (text <> '' or external_id is not null);
  delete from v4.buyer_facts where bot_id = p_bot_id and buyer_id = p_buyer_id;
  delete from v4.buyer_channels where bot_id = p_bot_id and buyer_id = p_buyer_id;
  update v4.cases set detail = jsonb_build_object('forgotten', true)
  where bot_id = p_bot_id and buyer_id = p_buyer_id and detail <> jsonb_build_object('forgotten', true);
  update v4.exam_candidates set question = '—', answer = '—'
  where bot_id = p_bot_id and buyer_id = p_buyer_id;
  insert into v4.case_events (bot_id, case_id, kind, detail, created_by)
  select p_bot_id, c.id, 'comment', jsonb_build_object('note', 'Покупатель обезличен по просьбе'), p_by
  from v4.cases c where c.bot_id = p_bot_id and c.buyer_id = p_buyer_id and c.status = 'open';
  return true;
end $$;

-- ── сигналы оператору ───────────────────────────────────────────────────────
insert into v4.case_policies values
  ('ai_health', 'operator', '4 hours', 'remind', null, null, false, 'now');

-- Проверить здоровье ИИ магазина и открыть дело ai_health (одно в час на
-- причину; в сутки — для кошелька). Возвращает причины, по которым дело открыто
-- или повторено. Зовёт ядро после простого ответа в боевом режиме.
create or replace function v4.ai_signals(p_bot_id uuid, p_now timestamptz default now())
returns text[] language plpgsql as $$
declare
  hour_key text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24');
  total integer;
  simple integer;
  failed integer;
  drift bigint;
  out text[] := '{}';
begin
  select count(*), count(*) filter (where source = 'fallback' and reason is not null)
  into total, simple
  from v4.messages
  where bot_id = p_bot_id and mode = 'live' and direction = 'out' and author = 'bot'
    and source in ('model', 'fallback') and created_at > p_now - interval '1 hour' and created_at <= p_now;
  if total >= 10 and simple * 10 > total then
    perform v4.open_case(p_bot_id, 'ai_health', 'simple:' || hour_key, 'ai', null, null,
      jsonb_build_object('reason', 'simple_share', 'simple', simple, 'total', total), p_now);
    out := array_append(out, 'simple_share');
  end if;

  select count(*) into failed from v4.messages
  where bot_id = p_bot_id and mode = 'live' and direction = 'out' and reason = 'model_failed'
    and created_at > p_now - interval '10 minutes' and created_at <= p_now;
  if failed >= 3 then
    perform v4.open_case(p_bot_id, 'ai_health', 'model_failed:' || hour_key, 'ai', null, null,
      jsonb_build_object('reason', 'model_failed', 'failed', failed), p_now);
    out := array_append(out, 'model_failed');
  end if;

  drift := v4.ai_wallet_drift(p_bot_id);
  if drift <> 0 then
    perform v4.open_case(p_bot_id, 'ai_health', 'wallet_drift:' || left(hour_key, 10), 'ai', null, null,
      jsonb_build_object('reason', 'wallet_drift', 'drift_micro_usd', drift), p_now);
    out := array_append(out, 'wallet_drift');
  end if;
  return out;
end $$;

alter table v4.exam_candidates enable row level security;
create policy tenant_isolation on v4.exam_candidates for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
revoke all on v4.exam_candidates from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.exam_candidates to service_role;
grant select, insert on v4.exam_candidates to tenant_bot;

revoke all on function v4.ai_value_report(uuid, timestamptz, timestamptz),
  v4.forget_buyer(uuid, uuid, text, timestamptz), v4.ai_signals(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function v4.ai_value_report(uuid, timestamptz, timestamptz),
  v4.forget_buyer(uuid, uuid, text, timestamptz), v4.ai_signals(uuid, timestamptz)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 1 таблицу, 3 функции и политику ai_health):
-- select (select count(*) from information_schema.tables where table_schema = 'v4' and table_name = 'exam_candidates') as t,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'v4' and p.proname in ('ai_value_report', 'forget_buyer', 'ai_signals')) as fns,
--        (select count(*) from v4.case_policies where kind = 'ai_health') as policy;
