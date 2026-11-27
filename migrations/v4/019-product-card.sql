-- v4/019: карточка товара, поиск по основе слова, отмена заказа покупателем
-- (этап 1 «Мозг магазина», шаг 5). Только схема v4. Применяет Яков после 018.
--
-- Главное:
--  * У товара описание, ключевые слова, фото и «с этим берут». Бот отвечает на
--    «какая бумага», «что входит» из карточки, а не передаёт продавцу.
--  * Поиск по основе слова: «папку» находит «Папка» (ошибка 7 от 05.11 — поиск
--    был подстрокой слова целиком). Вес: название > ключевые слова > описание.
--    Триграммы (pg_trgm) — когда каталог больше 500 товаров (этап BOVI), не сейчас.
--  * Покупатель отменяет только свой открытый заказ без денег и без чека на проверке.

alter table v4.products
  add column description text check (length(description) <= 4000),
  add column keywords text[] not null default '{}',
  add column photo_paths text[] not null default '{}',
  add column pairs_with uuid[] not null default '{}';

-- Основа слова: первые 5 букв у слов от 6 букв («выразительности» → «выраз»).
create or replace function v4.word_stem(p_word text) returns text
language sql immutable as $$
  select case when length(p_word) >= 6 then left(lower(p_word), 5) else lower(p_word) end
$$;

-- Слово запроса совпадает с текстом: по основе (5 букв) или, для слов 4–5 букв,
-- по первым length-1 буквам («папку» ~ «папка», «тетрадь» ~ «тетради»).
create or replace function v4.word_matches(p_text text, p_word text) returns boolean
language sql immutable as $$
  select case
    when p_word ~ '\d' then lower(coalesce(p_text, '')) ~ ('(^|[^0-9])' || p_word || '([^0-9]|$)')
    when length(p_word) >= 6 then position(v4.word_stem(p_word) in lower(coalesce(p_text, ''))) > 0
    when length(p_word) >= 4 then position(left(lower(p_word), length(p_word) - 1) in lower(coalesce(p_text, ''))) > 0
    else lower(coalesce(p_text, '')) ~ ('(^|[^[:alnum:]])' || lower(p_word) || '($|[^[:alnum:]])')
  end
$$;

-- Поиск товара для бота: по основе слов в названии, варианте, ключевых словах и
-- описании, только то, что продаётся. Подпись прежняя (005).
create or replace function v4.find_products(p_bot_id uuid, p_query text, p_limit integer default 8)
returns table (product_id uuid, title text, variant_label text, kind text, has_variants boolean)
language sql stable as $$
  with words as (
    select distinct w from regexp_split_to_table(lower(coalesce(p_query, '')), '[[:space:][:punct:]«»“”—–]+') w
    where length(w) >= 3 or w ~ '\d'),
  scored as (
    select p.id, p.title, p.variant_label, p.kind, p.parent_id,
      coalesce((select sum(
          3 * (v4.word_matches(coalesce(par.title, p.title) || ' ' || coalesce(p.variant_label, ''), w))::int
        + 2 * (v4.word_matches(array_to_string(p.keywords || coalesce(par.keywords, '{}'), ' '), w))::int
        + 1 * (v4.word_matches(coalesce(p.description, par.description), w))::int)
        from words), 0) as score
    from v4.products p
    left join v4.products par on par.id = p.parent_id
    where p.bot_id = p_bot_id and p.status = 'active' and coalesce(par.status, 'active') = 'active')
  select s.id, s.title, s.variant_label, s.kind,
    exists (select 1 from v4.products c where c.parent_id = s.id and c.status = 'active')
  from scored s
  where not exists (select 1 from words) or s.score > 0
  order by s.score desc, s.parent_id nulls first, s.title, s.variant_label nulls first, s.id
  limit greatest(1, least(p_limit, 20))
$$;

-- Карточка товара для бота: описание, ключевые слова, цена для страны покупателя,
-- варианты с ценами, «с этим берут». Только то, что продаётся.
create or replace function v4.product_details(p_bot_id uuid, p_product_id uuid, p_country text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'product_id', p.id,
    'title', coalesce(par.title, p.title) || coalesce(' · ' || p.variant_label, ''),
    'kind', p.kind,
    'description', coalesce(p.description, par.description),
    'keywords', to_jsonb(p.keywords || coalesce(par.keywords, '{}')),
    'has_photos', cardinality(p.photo_paths || coalesce(par.photo_paths, '{}')) > 0,
    'price', (select jsonb_build_object('currency', q.currency, 'amount_minor', q.total_minor)
              from v4.quote(p_bot_id, array[p.id], p_country) q),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', c.id, 'label', c.variant_label,
               'amount_minor', (select q.total_minor from v4.quote(p_bot_id, array[c.id], p_country) q),
               'currency', (select q.currency from v4.quote(p_bot_id, array[c.id], p_country) q))
             order by c.variant_label, c.id)
      from v4.products c where c.parent_id = p.id and c.status = 'active'), '[]'::jsonb),
    'pairs_with', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', x.id, 'title', x.title) order by x.title, x.id)
      from v4.products x
      where x.bot_id = p_bot_id and x.status = 'active'
        and x.id = any (p.pairs_with || coalesce(par.pairs_with, '{}'))), '[]'::jsonb))
  from v4.products p
  left join v4.products par on par.id = p.parent_id
  where p.bot_id = p_bot_id and p.id = p_product_id and p.status = 'active'
    and coalesce(par.status, 'active') = 'active'
$$;

-- Отмена заказа покупателем через бота (Д4). Только свой, открытый, без денег в
-- книге и без чека на проверке. Итог — код: ok, not_yours, not_open, paid, receipt_waiting.
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
  if not v4.close_order(p_bot_id, o.id, 'cancelled', 'Отменил покупатель в чате', 'buyer') then
    return 'not_open';
  end if;
  return 'ok';
end $$;

grant update (description, keywords, photo_paths, pairs_with) on v4.products to tenant_bot;

revoke all on function v4.word_stem(text), v4.word_matches(text, text),
  v4.product_details(uuid, uuid, text), v4.cancel_by_buyer(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function v4.word_stem(text), v4.word_matches(text, text),
  v4.product_details(uuid, uuid, text), v4.cancel_by_buyer(uuid, uuid, bigint)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 4 колонки и 1 — «папку» находит «Папка»):
-- select (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'products'
--          and column_name in ('description', 'keywords', 'photo_paths', 'pairs_with')) as cols,
--        v4.word_matches('Папка классного руководителя', 'папку')::int as stem_ok;
