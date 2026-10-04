-- 20-2: триграммные индексы под поиск площадки. Партия 20, пункт С2.
-- ТОЛЬКО ДОБАВЛЕНИЕ: расширение pg_trgm (если его ещё нет) и два индекса; таблицы и
-- данные не меняются. Применяет Яков своим словом, отдельно от 20-1: расширение
-- ставится один раз на базу. Пока не применена, поиск работает, но читает таблицу
-- целиком (ILIKE '%слово%' обычный индекс не использует). Откат: 20-2-search-trgm.down.sql.
--
-- Схема расширения берётся по факту: в Supabase оно обычно в схеме extensions, но если
-- уже стоит в другой схеме, класс операторов ищется там.
DO $$
DECLARE
  s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;
  SELECT n.nspname INTO s
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_trgm';
  -- Поиск товаров: .ilike("search_text", '%слово%') по каждому слову запроса.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_marketplace_items_search_trgm ON marketplace_items USING gin (search_text %I.gin_trgm_ops)',
    s);
  -- Поиск магазинов: .ilike("name", '%запрос%').
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_marketplace_shops_name_trgm ON marketplace_shops USING gin (name %I.gin_trgm_ops)',
    s);
END
$$;
