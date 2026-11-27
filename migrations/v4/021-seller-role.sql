-- v4/021: роль «продавец» на ядре ИИ-сотрудника (этап 1 «Мозг магазина», шаг 7).
-- Только схема v4. Применяет Яков после 020.
--
-- Главное:
--  * ИИ у магазина — дополнение: shops.ai_features, по умолчанию выключено
--    (buyer = false — канал ведёт себя как v3). Запись — условная по версии
--    ai_features_rev: второй сотрудник не затирает первого.
--  * Ответ продавца становится знанием сразу, но с телефоном, почтой, ссылкой,
--    суммой или именем — только после проверки продавцом (needs_review): ответ
--    одному покупателю не должен уйти всем.
--  * seller_context_v2 — всё на один ответ роли одним вызовом: анкета, флажки,
--    память о покупателе, кошелёк, местное время, знания (до 30 — все, больше —
--    8 ближайших к сообщению), открытые заказы, цены и реквизиты для проверки.
--  * «Остаток ИИ» в панели теперь — баланс кошелька (018), не месячный лимит (005).

alter table v4.shops
  add column ai_features jsonb not null default '{}'::jsonb,
  add column ai_features_rev integer not null default 0;

-- Флажки ИИ: только известные ключи и типы.
create or replace function v4.ai_features_valid(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k
      where k not in ('buyer', 'triage', 'country', 'postpay', 'objections', 'upsell',
                      'model', 'daily_cap_micro_usd', 'max_chars', 'prompt_variant'))
    and coalesce(jsonb_typeof(p -> 'buyer'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(p -> 'triage'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(p -> 'country'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(p -> 'postpay'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(p -> 'objections'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(p -> 'upsell'), 'boolean') = 'boolean'
    and coalesce(p ->> 'model', 'standard') in ('standard', 'fast')
    and (p -> 'daily_cap_micro_usd' is null or jsonb_typeof(p -> 'daily_cap_micro_usd') = 'null'
         or (jsonb_typeof(p -> 'daily_cap_micro_usd') = 'number' and (p ->> 'daily_cap_micro_usd')::numeric >= 0))
    and (p -> 'max_chars' is null
         or (jsonb_typeof(p -> 'max_chars') = 'number' and (p ->> 'max_chars')::numeric between 200 and 1200))
    and (p -> 'prompt_variant' is null
         or (jsonb_typeof(p -> 'prompt_variant') = 'string' and length(p ->> 'prompt_variant') between 1 and 40))
$$;

alter table v4.shops add constraint shops_ai_features_valid check (v4.ai_features_valid(ai_features));

-- Сохранить флажки. false — версия устарела (кто-то сохранил раньше) или магазина нет.
-- security definer: колонку ai_features напрямую арендатор не пишет, только так — с версией.
create or replace function v4.save_ai_features(p_bot_id uuid, p_features jsonb, p_rev integer)
returns boolean language plpgsql security definer set search_path = v4, pg_temp as $$
begin
  if v4.current_bot_id() is not null and v4.current_bot_id() <> p_bot_id then
    raise exception using errcode = 'P0001', message = 'v4:foreign_bot';
  end if;
  if not v4.ai_features_valid(coalesce(p_features, 'null'::jsonb)) then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  update v4.shops set ai_features = p_features, ai_features_rev = ai_features_rev + 1
  where bot_id = p_bot_id and ai_features_rev = p_rev;
  return found;
end $$;

-- ── знания на проверке ────────────────────────────────────────────────────
alter table v4.knowledge add column needs_review boolean not null default false;

-- Ответ, который нельзя повторять всем без взгляда продавца: телефон, почта,
-- ссылка, сумма (3+ цифры подряд или «1 500»), имя после «зовут/спросите/…».
create or replace function v4.knowledge_risky(p_text text) returns boolean
language sql immutable as $$
  select coalesce(p_text, '') ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}'
      or coalesce(p_text, '') ~* '(https?://|www\.|t\.me/)'
      or coalesce(p_text, '') ~ '\d{3,}'
      or coalesce(p_text, '') ~ '\d{1,3}[[:space:].,]\d{3}'
      or coalesce(p_text, '') ~ '(зовут|обращайтесь к|спросите|напишите|звоните|атым|есімім|my name is|ask for)\s+[А-ЯЁӘҒҚҢӨҰҮҺІA-Z]'
$$;

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
  return kid;
end $$;

-- Продавец посмотрел знание: approve — бот отвечает им всем; иначе знание выключено.
create or replace function v4.review_knowledge(p_bot_id uuid, p_knowledge_id uuid, p_approve boolean)
returns boolean language sql as $$
  with u as (
    update v4.knowledge set needs_review = false, active = active and p_approve
    where bot_id = p_bot_id and id = p_knowledge_id and needs_review returning 1)
  select exists (select 1 from u)
$$;

-- ── остаток ИИ = кошелёк ──────────────────────────────────────────────────
create or replace function v4.ai_room_micro_usd(p_bot_id uuid, p_now timestamptz default now())
returns bigint language sql stable as $$
  select coalesce((select w.balance_micro_usd from v4.ai_wallet w where w.bot_id = s.bot_id), 0)::bigint
  from v4.shops s where s.bot_id = p_bot_id
$$;

-- Старый журнал расхода (005) больше не открывает дело «лимит месяца»: деньги
-- считает кошелёк (018), пустой кошелёк открывает дело в ai_hold.
create or replace function v4.record_ai_usage(
  p_bot_id uuid, p_purpose text, p_model text, p_input integer, p_output integer,
  p_cost_micro_usd bigint, p_buyer_id uuid default null, p_now timestamptz default now()
) returns bigint language plpgsql as $$
begin
  insert into v4.ai_usage (bot_id, purpose, model, input_tokens, output_tokens, cost_micro_usd, buyer_id, created_at)
  values (p_bot_id, p_purpose, p_model, p_input, p_output, p_cost_micro_usd, p_buyer_id, p_now);
  return v4.ai_room_micro_usd(p_bot_id, p_now);
end $$;

-- Дневной предел по умолчанию (E06): три средних дня магазина за последние 14
-- (дни с расходом, не меньше 3 таких дней), но не меньше 1 доллара. Меньше
-- истории — предела нет. Флажок daily_cap_micro_usd его заменяет.
create or replace function v4.ai_auto_cap(p_bot_id uuid, p_now timestamptz default now())
returns bigint language sql stable as $$
  select case when count(*) >= 3 then greatest(1000000, (3 * avg(d.total))::bigint) end
  from (
    select (l.created_at at time zone s.timezone)::date as d_day, sum(l.total_micro_usd) as total
    from v4.ai_ledger l join v4.shops s on s.bot_id = l.bot_id
    where l.bot_id = p_bot_id and l.kind = 'settle' and l.mode = 'live'
      and (l.created_at at time zone s.timezone)::date between (p_now at time zone s.timezone)::date - 14
                                                          and (p_now at time zone s.timezone)::date - 1
    group by 1) d
$$;

-- ── контекст роли «продавец» ──────────────────────────────────────────────
create or replace function v4.seller_context_v2(
  p_bot_id uuid, p_buyer_id uuid, p_query text default '', p_now timestamptz default now()
) returns jsonb language sql stable as $$
  with s as (select * from v4.shops where bot_id = p_bot_id),
  b as (select * from v4.buyers where bot_id = p_bot_id and id = p_buyer_id),
  k as (
    select kn.id, kn.question, kn.answer, kn.created_at,
      (select count(*) from regexp_split_to_table(lower(coalesce(p_query, '')), '[[:space:][:punct:]«»“”—–]+') w
       where (length(w) >= 3 or w ~ '\d') and not v4.search_stopword(w)
         and v4.word_matches(kn.question || ' ' || kn.answer, w)) as score
    from v4.knowledge kn
    where kn.bot_id = p_bot_id and kn.active and not kn.needs_review),
  kt as (select count(*)::int as n from k)
  select jsonb_build_object(
    'profile', s.seller_profile,
    'features', s.ai_features,
    'timezone', s.timezone,
    'local_time', to_char(p_now at time zone s.timezone, 'YYYY-MM-DD HH24:MI'),
    'weekday', extract(isodow from p_now at time zone s.timezone)::int,
    'base_currency', s.base_currency,
    'wallet_micro_usd', v4.ai_room_micro_usd(s.bot_id, p_now),
    'auto_cap_micro_usd', v4.ai_auto_cap(s.bot_id, p_now),
    'country', (select country from b),
    'language', coalesce((select language from b), 'ru'),
    'facts', coalesce((select jsonb_object_agg(f.key, f.value) from v4.buyer_facts f
                       where f.bot_id = p_bot_id and f.buyer_id = p_buyer_id), '{}'::jsonb),
    'knowledge_total', (select n from kt),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('question', x.question, 'answer', x.answer) order by x.ord)
      from (
        select k.question, k.answer,
          row_number() over (order by case when (select n from kt) <= 30 then 0 else -k.score end,
                                      k.created_at, k.id) as ord
        from k
        where (select n from kt) <= 30 or k.score > 0) x
      where x.ord <= case when (select n from kt) <= 30 then 30 else 8 end), '[]'::jsonb),
    'open_orders', coalesce((
      select jsonb_agg(jsonb_build_object('no', m.no, 'total_minor', m.total_minor, 'paid_minor', m.paid_minor,
                                          'currency', m.currency, 'money_state', m.money_state)
                       order by m.no)
      from v4.buyer_open_orders(p_bot_id, p_buyer_id) m), '[]'::jsonb),
    -- Цены всех продаваемых товаров для страны покупателя: проверка ответа знает их.
    'prices_minor', coalesce((
      select jsonb_agg(distinct q.total_minor)
      from v4.products p
      left join v4.products par on par.id = p.parent_id
      cross join lateral v4.quote(p_bot_id, array[p.id], (select country from b)) q
      where p.bot_id = p_bot_id and p.status = 'active' and coalesce(par.status, 'active') = 'active'
        and q.total_minor > 0), '[]'::jsonb),
    -- Реквизиты способов оплаты: их бот может назвать, это не «чужой контакт».
    'payment_details', coalesce((
      select jsonb_agg(pm.details order by pm.kind, pm.id)
      from v4.methods_for(p_bot_id, (select country from b)) pm), '[]'::jsonb))
  from s
$$;

-- Товары предложения покупателя: по ним нажатие на устаревшую кнопку строит новое (Д3).
create or replace function v4.offer_products(p_bot_id uuid, p_buyer_id uuid, p_offer_id text)
returns jsonb language sql stable as $$
  select jsonb_build_object('product_ids', to_jsonb(f.product_ids), 'mode', f.mode)
  from v4.offers f where f.bot_id = p_bot_id and f.buyer_id = p_buyer_id and f.id = upper(p_offer_id)
$$;

grant update (needs_review) on v4.knowledge to tenant_bot;

revoke all on function v4.ai_features_valid(jsonb), v4.save_ai_features(uuid, jsonb, integer),
  v4.knowledge_risky(text), v4.review_knowledge(uuid, uuid, boolean),
  v4.seller_context_v2(uuid, uuid, text, timestamptz), v4.offer_products(uuid, uuid, text), v4.ai_auto_cap(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function v4.ai_features_valid(jsonb), v4.save_ai_features(uuid, jsonb, integer),
  v4.knowledge_risky(text), v4.review_knowledge(uuid, uuid, boolean),
  v4.seller_context_v2(uuid, uuid, text, timestamptz), v4.offer_products(uuid, uuid, text), v4.ai_auto_cap(uuid, timestamptz)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 2 колонки магазина и 1 колонку знаний):
-- select (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'shops'
--          and column_name in ('ai_features', 'ai_features_rev')) as shop_cols,
--        (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'knowledge'
--          and column_name = 'needs_review') as knowledge_cols;
