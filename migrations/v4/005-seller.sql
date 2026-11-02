-- v4/005: ИИ-продавец (этап 4а; решения 6, 9, 44, 56, 98).
-- Только схема v4. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- Главное:
--  * ИИ входит в тариф (решение 98): у магазина месячный лимит в микродолларах,
--    каждый вызов модели пишется в v4.ai_usage. Лимит кончился — бот отвечает
--    простыми ответами без модели и открывает продавцу дело «ИИ-лимит» (44).
--  * Ответ продавца на вопрос, который бот передал, становится знанием (решение 9):
--    в следующий раз бот отвечает сам.
--  * Анкета магазина — единственный источник условий оплаты и выдачи для бота
--    (CLAUDE.md: «условия консультант берёт только из анкеты продавца»).
--  * Спам в комментариях отсекается без ИИ (решение 56): простые правила магазина.

alter table v4.shops
  add column ai_monthly_limit_micro_usd bigint not null default 5000000 check (ai_monthly_limit_micro_usd >= 0),
  add column seller_profile jsonb not null default '{}'::jsonb,
  add column spam_words text[] not null default '{}';

create table v4.ai_usage (
  id bigint generated always as identity primary key,
  bot_id uuid not null references v4.shops (bot_id),
  purpose text not null check (purpose in ('seller', 'comment')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0),
  buyer_id uuid,
  created_at timestamptz not null default now()
);
create index ai_usage_bot_month on v4.ai_usage (bot_id, created_at);

-- Сколько осталось в этом месяце (по часам магазина). Отрицательное — перерасход.
create or replace function v4.ai_room_micro_usd(p_bot_id uuid, p_now timestamptz default now())
returns bigint language sql stable as $$
  select s.ai_monthly_limit_micro_usd - coalesce((
    select sum(u.cost_micro_usd) from v4.ai_usage u
    where u.bot_id = s.bot_id
      and u.created_at >= (date_trunc('month', p_now at time zone s.timezone) at time zone s.timezone)
  ), 0)::bigint
  from v4.shops s where s.bot_id = p_bot_id
$$;

-- Записать расход. Если лимит этим вызовом кончился — дело продавцу «пополнить», одно на месяц.
create or replace function v4.record_ai_usage(
  p_bot_id uuid, p_purpose text, p_model text, p_input integer, p_output integer,
  p_cost_micro_usd bigint, p_buyer_id uuid default null, p_now timestamptz default now()
) returns bigint language plpgsql as $$
declare
  room bigint;
  s v4.shops;
begin
  insert into v4.ai_usage (bot_id, purpose, model, input_tokens, output_tokens, cost_micro_usd, buyer_id, created_at)
  values (p_bot_id, p_purpose, p_model, p_input, p_output, p_cost_micro_usd, p_buyer_id, p_now);
  room := v4.ai_room_micro_usd(p_bot_id, p_now);
  if room <= 0 then
    select * into s from v4.shops where bot_id = p_bot_id;
    perform v4.open_case(p_bot_id, 'ai_limit', 'month:' || to_char(p_now at time zone s.timezone, 'YYYY-MM'),
                         'ai', null, null, jsonb_build_object('limit_micro_usd', s.ai_monthly_limit_micro_usd), p_now);
  end if;
  return room;
end $$;

-- ── знания из ответов продавца (решение 9) ────────────────────────────────
create table v4.knowledge (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  product_id uuid,
  question text not null check (length(question) between 1 and 1000),
  answer text not null check (length(answer) between 1 and 4000),
  source text not null check (source in ('seller_reply', 'manual')),
  case_id uuid,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (bot_id, product_id) references v4.products (bot_id, id),
  foreign key (bot_id, case_id) references v4.cases (bot_id, id)
);
create index knowledge_bot on v4.knowledge (bot_id, created_at desc) where active;
-- Один ответ продавца на одно дело — одно знание.
create unique index knowledge_once_per_case on v4.knowledge (case_id) where case_id is not null;

-- Продавец ответил на переданный вопрос: знание + дело закрыто + диалог снова у бота.
create or replace function v4.learn_from_reply(
  p_bot_id uuid, p_case_id uuid, p_question text, p_answer text,
  p_product_id uuid default null, p_created_by text default 'seller'
) returns uuid language plpgsql as $$
declare
  kid uuid;
begin
  insert into v4.knowledge (bot_id, product_id, question, answer, source, case_id, created_by)
  values (p_bot_id, p_product_id, p_question, p_answer, 'seller_reply', p_case_id, p_created_by)
  on conflict (case_id) where case_id is not null do nothing
  returning id into kid;
  perform v4.close_case(p_bot_id, p_case_id, 'Продавец ответил, ответ сохранён в знания', p_created_by);
  if kid is null then
    select id into kid from v4.knowledge where case_id = p_case_id;
  end if;
  return kid;
end $$;

-- Поиск товара для бота: по словам названия и варианта, только то, что продаётся.
create or replace function v4.find_products(p_bot_id uuid, p_query text, p_limit integer default 8)
returns table (product_id uuid, title text, variant_label text, kind text, has_variants boolean)
language sql stable as $$
  with words as (
    select w from regexp_split_to_table(lower(coalesce(p_query, '')), '[[:space:][:punct:]]+') w where length(w) >= 2
  )
  select p.id, p.title, p.variant_label, p.kind,
    exists (select 1 from v4.products c where c.parent_id = p.id and c.status = 'active')
  from v4.products p
  left join v4.products par on par.id = p.parent_id
  where p.bot_id = p_bot_id and p.status = 'active' and coalesce(par.status, 'active') = 'active'
    and (not exists (select 1 from words)
         or exists (select 1 from words where lower(p.title || ' ' || coalesce(p.variant_label, '')) like '%' || w || '%'))
  order by (select count(*) from words where lower(p.title || ' ' || coalesce(p.variant_label, '')) like '%' || w || '%') desc,
    p.parent_id nulls first, p.title, p.variant_label nulls first, p.id
  limit greatest(1, least(p_limit, 20))
$$;

-- Карточка одного товара для кнопки «Купить»: только то, что продаётся.
create or replace function v4.product_card(p_bot_id uuid, p_product_id uuid)
returns table (product_id uuid, title text, has_variants boolean) language sql stable as $$
  select p.id, p.title || coalesce(' · ' || p.variant_label, ''),
    exists (select 1 from v4.products c where c.parent_id = p.id and c.status = 'active')
  from v4.products p
  left join v4.products par on par.id = p.parent_id
  where p.bot_id = p_bot_id and p.id = p_product_id and p.status = 'active'
    and coalesce(par.status, 'active') = 'active'
$$;

-- Цена для покупателя до заказа (решения 4, 91): та же валюта, что выберет create_order.
create or replace function v4.quote(p_bot_id uuid, p_product_ids uuid[], p_country text)
returns table (currency text, total_minor bigint) language plpgsql stable as $$
declare
  cur text;
begin
  cur := (select cc.currency from v4.country_currency cc where cc.country = p_country);
  if cur is null or exists (select 1 from unnest(p_product_ids) u(id) where v4.price_minor(p_bot_id, u.id, cur) is null) then
    cur := (select s.base_currency from v4.shops s where s.bot_id = p_bot_id);
  end if;
  return query select cur, coalesce(sum(v4.price_minor(p_bot_id, u.id, cur)), 0)::bigint from unnest(p_product_ids) u(id);
end $$;

-- Всё, что нужно продавцу-боту на один ответ, одним вызовом: анкета, остаток ИИ,
-- месяц (ключ дела «ИИ-лимит»), страна и язык покупателя, все активные знания.
create or replace function v4.seller_context(p_bot_id uuid, p_buyer_id uuid, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profile', s.seller_profile,
    'spam_words', to_jsonb(s.spam_words),
    'ai_room_micro_usd', v4.ai_room_micro_usd(s.bot_id, p_now),
    'month', to_char(p_now at time zone s.timezone, 'YYYY-MM'),
    'base_currency', s.base_currency,
    'country', b.country,
    'language', coalesce(b.language, 'ru'),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('question', k.question, 'answer', k.answer) order by k.created_at, k.id)
      from v4.knowledge k where k.bot_id = s.bot_id and k.active
    ), '[]'::jsonb))
  from v4.shops s
  left join v4.buyers b on b.bot_id = s.bot_id and b.id = p_buyer_id
  where s.bot_id = p_bot_id
$$;

-- Открытые заказы покупателя с деньгами из книги (для вопроса «где мой заказ»).
create or replace function v4.buyer_open_orders(p_bot_id uuid, p_buyer_id uuid)
returns setof v4.order_money language sql stable as $$
  select m.* from v4.order_money m
  join v4.orders o on o.bot_id = m.bot_id and o.id = m.order_id
  where m.bot_id = p_bot_id and o.buyer_id = p_buyer_id and o.status = 'open'
  order by o.created_at, o.id
$$;

alter table v4.ai_usage enable row level security;
alter table v4.knowledge enable row level security;
create policy tenant_isolation on v4.ai_usage for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.knowledge for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.ai_usage, v4.knowledge from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.ai_usage, v4.knowledge to service_role;
grant select, insert on v4.ai_usage to tenant_bot;
grant select, insert on v4.knowledge to tenant_bot;
grant update (active, answer, question) on v4.knowledge to tenant_bot;
grant update (seller_profile, spam_words) on v4.shops to tenant_bot;
-- Лимит ИИ задаёт тариф, не продавец: колонку ai_monthly_limit_micro_usd меняет только сервисная роль.

revoke all on all functions in schema v4 from public, anon, authenticated;
grant execute on all functions in schema v4 to service_role, tenant_bot;
revoke execute on function v4.tick(timestamptz), v4.tick_cases(timestamptz), v4.claim_notifications(text, integer, timestamptz),
  v4.finish_notification(bigint, text, text), v4.expire_notification_leases(timestamptz),
  v4.claim_jobs(integer, interval, timestamptz),
  v4.finish_job(bigint, boolean, text, interval), v4.expire_access(timestamptz),
  v4.cabinet_items(uuid, text, timestamptz) from tenant_bot;

-- Бот выдаёт ссылку в кабинет («потерял файл»): только своему покупателю своего магазина.
-- В базе — sha256 токена; читать по токену (cabinet_items) по-прежнему может только сервис.
create policy tenant_isolation on v4.cabinet_links for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
grant select, insert on v4.cabinet_links to tenant_bot;

-- Проверка (должно вернуть 2 таблицы и колонку лимита):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename in ('ai_usage', 'knowledge')) as tables,
--        (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'shops'
--          and column_name = 'ai_monthly_limit_micro_usd') as limit_col;
