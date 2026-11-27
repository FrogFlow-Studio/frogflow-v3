-- v4/022: перенос ИИ-продавца v3 → v4 (этап 1 «Мозг магазина», шаг 9;
-- Спецификация, раздел 3). Только схема v4. Применяет Яков после 021.
--
-- Главное:
--  * Одна функция пишет план переноса (его строит src/v4/transfer/plan.ts из
--    снимка v3) одной транзакцией: анкета, язык магазина, флажки ИИ, знания,
--    тексты и фото товаров (пути Storage, файлы не копируются), последние 24 сообщения консультанта на покупателя, блоки.
--  * Повторный запуск ничего не задваивает: знание с тем же вопросом и ответом
--    не вставляется, описание и фото товара пишутся только в пустые, история покупателя
--    переносится один раз, блок не трогает уже заблокированного.
--  * Остаток ИИ переносит ai_transfer_from_v3 (018) — после переключения, один раз.
--  * Только сервисная роль: перенос запускает оператор в день переезда.

create or replace function v4.transfer_from_v3(p_bot_id uuid, p_plan jsonb, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  k jsonb;
  h jsonb;
  m jsonb;
  buyer uuid;
  i integer;
  n_knowledge integer := 0;
  n_products integer := 0;
  n_history integer := 0;
  n_blocked integer := 0;
  missing text[] := '{}';
begin
  if not exists (select 1 from v4.shops where bot_id = p_bot_id) then
    raise exception using errcode = 'P0001', message = 'v4:shop_not_found';
  end if;
  if not v4.ai_features_valid(coalesce(p_plan -> 'features', '{}'::jsonb)) then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;

  -- Анкета: перенесённые поля поверх (новые поля v4 продавец заполняет сам), язык, флажки.
  update v4.shops set
    seller_profile = seller_profile || coalesce(p_plan -> 'profile', '{}'::jsonb),
    default_lang = coalesce(p_plan ->> 'default_lang', default_lang),
    ai_features = ai_features || coalesce(p_plan -> 'features', '{}'::jsonb),
    ai_features_rev = ai_features_rev + 1
  where bot_id = p_bot_id;

  for k in select * from jsonb_array_elements(coalesce(p_plan -> 'knowledge', '[]'::jsonb)) loop
    if not exists (select 1 from v4.knowledge x
                   where x.bot_id = p_bot_id and x.question = k ->> 'question' and x.answer = k ->> 'answer') then
      insert into v4.knowledge (bot_id, question, answer, source, created_by, needs_review, created_at)
      values (p_bot_id, k ->> 'question', k ->> 'answer', 'manual', 'v3',
              coalesce((k ->> 'needs_review')::boolean, false) or v4.knowledge_risky(k ->> 'answer'), p_now);
      n_knowledge := n_knowledge + 1;
    end if;
  end loop;

  for k in select * from jsonb_array_elements(coalesce(p_plan -> 'product_texts', '[]'::jsonb)) loop
    update v4.products p set
      description = coalesce(nullif(p.description, ''), k ->> 'description'),
      photo_paths = case when cardinality(p.photo_paths) > 0 then p.photo_paths
                         else array(select jsonb_array_elements_text(coalesce(k -> 'photos', '[]'::jsonb))) end,
      keywords = (select coalesce(array_agg(distinct w order by w), '{}')
                  from unnest(p.keywords || array(select jsonb_array_elements_text(coalesce(k -> 'keywords', '[]'::jsonb)))) w)
    where p.bot_id = p_bot_id and p.id = (k ->> 'product_id')::uuid;
    if found then n_products := n_products + 1; end if;
  end loop;

  for h in select * from jsonb_array_elements(coalesce(p_plan -> 'histories', '[]'::jsonb)) loop
    select c.buyer_id into buyer from v4.buyer_channels c
    where c.bot_id = p_bot_id and c.channel = 'telegram' and c.external_id = h ->> 'telegram_id';
    if buyer is null then
      missing := missing || (h ->> 'telegram_id');
      continue;
    end if;
    if exists (select 1 from v4.messages x where x.bot_id = p_bot_id and x.buyer_id = buyer and x.source = 'v3') then
      continue;
    end if;
    i := 0;
    for m in select * from jsonb_array_elements(h -> 'messages') loop
      i := i + 1;
      -- Старше настоящих сообщений, по порядку: модель видит их первыми.
      insert into v4.messages (bot_id, buyer_id, channel, direction, author, mode, text, source, created_at)
      values (p_bot_id, buyer, 'telegram', m ->> 'direction',
              case when m ->> 'direction' = 'in' then 'buyer' else 'bot' end, 'live',
              left(m ->> 'text', 8000), 'v3', p_now - interval '1 hour' + i * interval '1 millisecond');
    end loop;
    n_history := n_history + 1;
  end loop;

  with b as (
    update v4.buyers u set blocked_at = p_now, blocked_by = 'v3'
    from v4.buyer_channels c
    where c.bot_id = p_bot_id and c.channel = 'telegram'
      and c.external_id = any (array(select jsonb_array_elements_text(coalesce(p_plan -> 'blocked_telegram_ids', '[]'::jsonb))))
      and u.bot_id = c.bot_id and u.id = c.buyer_id and u.blocked_at is null
    returning 1)
  select count(*) into n_blocked from b;

  return jsonb_build_object('knowledge', n_knowledge, 'products', n_products, 'histories', n_history,
                            'blocked', n_blocked, 'missing_buyers', to_jsonb(missing));
end $$;

-- Каталог магазина для плана переноса: по нему статьи знаний v3 ложатся в карточки.
create or replace function v4.transfer_catalog(p_bot_id uuid)
returns table (product_id uuid, title text, variant_label text, description text, keywords text[])
language sql stable as $$
  select p.id, p.title, p.variant_label, p.description, p.keywords
  from v4.products p where p.bot_id = p_bot_id and p.status = 'active'
  order by p.title, p.variant_label nulls first, p.id
$$;

revoke all on function v4.transfer_from_v3(uuid, jsonb, timestamptz), v4.transfer_catalog(uuid)
  from public, anon, authenticated, tenant_bot;
grant execute on function v4.transfer_from_v3(uuid, jsonb, timestamptz), v4.transfer_catalog(uuid) to service_role;

-- Проверка (должно вернуть 2):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and p.proname in ('transfer_from_v3', 'transfer_catalog');
