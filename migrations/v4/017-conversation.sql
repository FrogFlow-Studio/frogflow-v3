-- v4/017: разговор и память ИИ-продавца (этап 1 «Мозг магазина», шаг 2).
-- Только схема v4. Таблицы public не трогает. Применяет Яков после 016.
--
-- Главное:
--  * Журнал сообщений v4.messages — входящие и ответы с кнопками и действиями.
--    В 05.11 история хранила только текст, и бот снова и снова писал «нажмите
--    Купить»: модель не знала, что кнопка уже была. Теперь кнопки в журнале.
--  * Повтор вебхука даёт ту же строку: уникальный (bot, канал, внешний id) у входящих.
--  * Ход: один ответ на покупателя за раз — условная запись turn_until < now().
--    Второе сообщение, пришедшее во время хода, ответ получит вместе с первым.
--  * Предел ответов ИИ одному покупателю в день — условное увеличение счётчика
--    (по умолчанию 40; 41-е сообщение получает простой ответ без ИИ).
--  * Блок покупателя: бот молчит, ИИ не тратится.
--  * Память о покупателе — только ключи из списка и короткие значения; суммы,
--    телефоны, почта, обещания и скидки не запоминаются (проверка в базе).
--  * Режимы: live — настоящий ответ; shadow — тень, покупатель ничего не видит;
--    test — окно проверки продавца и экзамен. Режим пишется в каждую строку.

-- ── покупатель: блок, ход, счётчик ответов ИИ ──────────────────────────────
alter table v4.buyers
  add column blocked_at timestamptz,
  add column blocked_by text,
  add column turn_id uuid,
  add column turn_until timestamptz,
  add column ai_replies_day integer not null default 0 check (ai_replies_day >= 0),
  add column ai_replies_date date;

-- ── журнал сообщений ───────────────────────────────────────────────────────
create table v4.messages (
  id bigint generated always as identity primary key,
  bot_id uuid not null references v4.shops (bot_id),
  buyer_id uuid not null,
  channel text not null check (channel in ('telegram', 'instagram', 'whatsapp', 'web', 'test')),
  external_id text check (external_id <> ''),
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('buyer', 'bot', 'seller')),
  mode text not null default 'live' check (mode in ('live', 'shadow', 'test')),
  text text not null default '' check (length(text) <= 8000),
  -- Показанные кнопки: [{offer_id|product_id, label}] — модель видит их в истории.
  buttons jsonb not null default '[]'::jsonb check (jsonb_typeof(buttons) = 'array'),
  -- Что бот сделал: [{kind, ...}] — передал продавцу, отменил заказ, запомнил факт.
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  -- model — ответ модели, fallback — простой ответ без ИИ, v3 — перенесено из v3.
  source text check (source in ('model', 'fallback', 'seller', 'v3')),
  -- Почему простой ответ: limit_buyer, limit_day, wallet_empty, model_failed, check_failed.
  reason text check (reason <> ''),
  -- Расход на ответ с наценкой (микродоллары); у входящих 0.
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  prompt_variant text,
  -- Итог проверки ответа: ok или код причины отказа (price_unknown, wrong_language…).
  check_result text,
  created_at timestamptz not null default now(),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  check (direction = 'out' or author = 'buyer'),
  check (direction = 'in' or author <> 'buyer')
);
create index messages_buyer on v4.messages (bot_id, buyer_id, created_at desc, id desc);
-- Повтор вебхука: то же входящее сообщение — та же строка.
create unique index messages_incoming_once on v4.messages (bot_id, channel, external_id)
  where direction = 'in' and external_id is not null;

-- ── память о покупателе ────────────────────────────────────────────────────
create table v4.buyer_facts (
  bot_id uuid not null references v4.shops (bot_id),
  buyer_id uuid not null,
  key text not null check (key in ('language', 'country', 'name', 'looking_for', 'grade', 'subject', 'for_whom', 'notes')),
  value text not null check (length(value) between 1 and 100),
  source text not null check (source in ('buyer', 'bot', 'seller')),
  updated_at timestamptz not null default now(),
  primary key (bot_id, buyer_id, key),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);

-- Записать входящее. Повтор того же внешнего id — duplicate = true и та же строка.
create or replace function v4.record_incoming(
  p_bot_id uuid, p_buyer_id uuid, p_channel text, p_external_id text, p_text text,
  p_mode text default 'live', p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  mid bigint;
begin
  insert into v4.messages (bot_id, buyer_id, channel, external_id, direction, author, mode, text, created_at)
  values (p_bot_id, p_buyer_id, p_channel, nullif(p_external_id, ''), 'in', 'buyer', p_mode,
          left(coalesce(p_text, ''), 8000), p_now)
  on conflict (bot_id, channel, external_id) where direction = 'in' and external_id is not null do nothing
  returning id into mid;
  if mid is not null then
    return jsonb_build_object('message_id', mid, 'duplicate', false);
  end if;
  select id into mid from v4.messages
  where bot_id = p_bot_id and channel = p_channel and external_id = p_external_id and direction = 'in';
  return jsonb_build_object('message_id', mid, 'duplicate', true);
end $$;

-- Взять ход: true только у одного из одновременных вызовов. Ход истекает сам
-- через p_ttl_seconds (упавшая функция не держит покупателя вечно).
create or replace function v4.take_turn(
  p_bot_id uuid, p_buyer_id uuid, p_turn_id uuid, p_ttl_seconds integer default 90,
  p_now timestamptz default now()
) returns boolean language sql as $$
  with won as (
    update v4.buyers set turn_id = p_turn_id, turn_until = p_now + make_interval(secs => greatest(10, least(p_ttl_seconds, 300)))
    where bot_id = p_bot_id and id = p_buyer_id and (turn_until is null or turn_until <= p_now)
    returning 1)
  select exists (select 1 from won)
$$;

-- Отпустить ход. Возвращает входящие, пришедшие после p_after_message_id, на
-- которые ещё нет ответа: держатель хода отвечает на них следующим кругом.
create or replace function v4.release_turn(
  p_bot_id uuid, p_buyer_id uuid, p_turn_id uuid, p_after_message_id bigint
) returns bigint language plpgsql as $$
declare
  pending bigint;
begin
  select count(*) into pending from v4.messages m
  where m.bot_id = p_bot_id and m.buyer_id = p_buyer_id and m.direction = 'in' and m.id > p_after_message_id;
  if pending = 0 then
    update v4.buyers set turn_id = null, turn_until = null
    where bot_id = p_bot_id and id = p_buyer_id and turn_id = p_turn_id;
  end if;
  return pending;
end $$;

-- Ещё один ответ ИИ покупателю сегодня (по часам магазина), если предел не
-- достигнут. Условное увеличение: два одновременных вызова на последнем месте
-- не пройдут оба.
create or replace function v4.count_ai_reply(
  p_bot_id uuid, p_buyer_id uuid, p_limit integer default 40, p_now timestamptz default now()
) returns boolean language sql as $$
  with today as (
    select (p_now at time zone s.timezone)::date d from v4.shops s where s.bot_id = p_bot_id),
  won as (
    update v4.buyers b set
      ai_replies_day = case when b.ai_replies_date = t.d then b.ai_replies_day + 1 else 1 end,
      ai_replies_date = t.d
    from today t
    where b.bot_id = p_bot_id and b.id = p_buyer_id
      and (b.ai_replies_date is distinct from t.d or b.ai_replies_day < p_limit)
    returning 1)
  select exists (select 1 from won)
$$;

-- Ответ бота или продавца в журнал.
create or replace function v4.record_reply(
  p_bot_id uuid, p_buyer_id uuid, p_channel text, p_text text,
  p_buttons jsonb default '[]'::jsonb, p_actions jsonb default '[]'::jsonb,
  p_mode text default 'live', p_source text default 'model', p_reason text default null,
  p_cost_micro_usd bigint default 0, p_prompt_variant text default null,
  p_check_result text default null, p_author text default 'bot', p_now timestamptz default now()
) returns bigint language sql as $$
  insert into v4.messages (bot_id, buyer_id, channel, direction, author, mode, text, buttons, actions,
                           source, reason, cost_micro_usd, prompt_variant, check_result, created_at)
  values (p_bot_id, p_buyer_id, p_channel, 'out', p_author, p_mode, left(coalesce(p_text, ''), 8000),
          coalesce(p_buttons, '[]'::jsonb), coalesce(p_actions, '[]'::jsonb), p_source, p_reason,
          greatest(coalesce(p_cost_micro_usd, 0), 0), p_prompt_variant, p_check_result, p_now)
  returning id
$$;

-- Последние p_limit сообщений покупателя в этом режиме, старые первыми.
create or replace function v4.conversation_history(
  p_bot_id uuid, p_buyer_id uuid, p_mode text default 'live', p_limit integer default 20
) returns table (id bigint, direction text, author text, text text, buttons jsonb, actions jsonb, created_at timestamptz)
language sql stable as $$
  select h.id, h.direction, h.author, h.text, h.buttons, h.actions, h.created_at from (
    select m.* from v4.messages m
    where m.bot_id = p_bot_id and m.buyer_id = p_buyer_id and m.mode = p_mode
    order by m.created_at desc, m.id desc
    limit greatest(1, least(p_limit, 50))) h
  order by h.created_at, h.id
$$;

-- Запомнить факт о покупателе. Отказ (код) вместо записи, если значение похоже
-- на сумму, телефон, карту, почту, обещание или скидку: такие «факты» модель
-- потом выдала бы за правило магазина.
create or replace function v4.remember_fact(
  p_bot_id uuid, p_buyer_id uuid, p_key text, p_value text, p_source text default 'bot',
  p_now timestamptz default now()
) returns text language plpgsql as $$
declare
  v text := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
  maxlen integer;
begin
  if p_key not in ('language', 'country', 'name', 'looking_for', 'grade', 'subject', 'for_whom', 'notes') then
    return 'bad_key';
  end if;
  maxlen := case p_key when 'name' then 40 when 'subject' then 60 when 'language' then 2 when 'country' then 2 else 100 end;
  if v = '' or length(v) > maxlen then return 'bad_value'; end if;
  if p_key = 'language' and v not in ('ru', 'kk', 'en', 'uz') then return 'bad_value'; end if;
  if p_key = 'country' then
    v := upper(v);
    if not exists (select 1 from v4.country_currency where country = v) then return 'bad_value'; end if;
  end if;
  if p_key = 'grade' and not (v ~ '^\d{1,2}$' and v::int between 1 and 11) then return 'bad_value'; end if;
  if p_key <> 'grade' and (
       v ~ '\d{3}'                                   -- суммы, телефоны, карты
       or v ~ '\d\s*%'                               -- проценты
       or v ~ '[@]|https?://|www\.'                  -- почта, ссылки
       or v ~* '(₸|тенге|тг\.?\M|руб|₽|\$|usd|kzt|сум\M|so''m|сом\M|€|eur)'
       or v ~* '(скидк|бесплатн|обещ|подар|жеңілдік|тегін|discount|free\M|chegirma|bepul)') then
    return 'forbidden';
  end if;
  insert into v4.buyer_facts (bot_id, buyer_id, key, value, source, updated_at)
  values (p_bot_id, p_buyer_id, p_key, v, p_source, p_now)
  on conflict (bot_id, buyer_id, key) do update set value = excluded.value, source = excluded.source,
    updated_at = excluded.updated_at;
  if p_key = 'language' then
    update v4.buyers set language = v where bot_id = p_bot_id and id = p_buyer_id;
  elsif p_key = 'country' then
    update v4.buyers set country = v where bot_id = p_bot_id and id = p_buyer_id;
  end if;
  return 'ok';
end $$;

-- Блок покупателя продавцом и снятие блока. Повтор ничего не меняет.
create or replace function v4.block_buyer(p_bot_id uuid, p_buyer_id uuid, p_by text, p_now timestamptz default now())
returns boolean language sql as $$
  with b as (
    update v4.buyers set blocked_at = p_now, blocked_by = p_by
    where bot_id = p_bot_id and id = p_buyer_id and blocked_at is null returning 1)
  select exists (select 1 from b)
$$;
create or replace function v4.unblock_buyer(p_bot_id uuid, p_buyer_id uuid)
returns boolean language sql as $$
  with b as (
    update v4.buyers set blocked_at = null, blocked_by = null
    where bot_id = p_bot_id and id = p_buyer_id and blocked_at is not null returning 1)
  select exists (select 1 from b)
$$;

-- ── права ──────────────────────────────────────────────────────────────────
alter table v4.messages enable row level security;
alter table v4.buyer_facts enable row level security;
create policy tenant_isolation on v4.messages for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.buyer_facts for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.messages, v4.buyer_facts from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.messages, v4.buyer_facts to service_role;
grant select, insert on v4.messages to tenant_bot;
grant select, insert, update on v4.buyer_facts to tenant_bot;
grant update (blocked_at, blocked_by, turn_id, turn_until, ai_replies_day, ai_replies_date, language, country)
  on v4.buyers to tenant_bot;

revoke all on function v4.record_incoming(uuid, uuid, text, text, text, text, timestamptz),
  v4.take_turn(uuid, uuid, uuid, integer, timestamptz), v4.release_turn(uuid, uuid, uuid, bigint),
  v4.count_ai_reply(uuid, uuid, integer, timestamptz),
  v4.record_reply(uuid, uuid, text, text, jsonb, jsonb, text, text, text, bigint, text, text, text, timestamptz),
  v4.conversation_history(uuid, uuid, text, integer),
  v4.remember_fact(uuid, uuid, text, text, text, timestamptz),
  v4.block_buyer(uuid, uuid, text, timestamptz), v4.unblock_buyer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function v4.record_incoming(uuid, uuid, text, text, text, text, timestamptz),
  v4.take_turn(uuid, uuid, uuid, integer, timestamptz), v4.release_turn(uuid, uuid, uuid, bigint),
  v4.count_ai_reply(uuid, uuid, integer, timestamptz),
  v4.record_reply(uuid, uuid, text, text, jsonb, jsonb, text, text, text, bigint, text, text, text, timestamptz),
  v4.conversation_history(uuid, uuid, text, integer),
  v4.remember_fact(uuid, uuid, text, text, text, timestamptz),
  v4.block_buyer(uuid, uuid, text, timestamptz), v4.unblock_buyer(uuid, uuid)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 2 таблицы и 6 новых колонок покупателя):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename in ('messages', 'buyer_facts')) as tables,
--        (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'buyers'
--          and column_name in ('blocked_at', 'blocked_by', 'turn_id', 'turn_until', 'ai_replies_day', 'ai_replies_date')) as cols;
