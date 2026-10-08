-- 23-1: индексы и настройки функций по советнику Supabase. Пункт 21 плана работ.
-- Таблицы, колонки и данные не меняются (база общая с v1). Новый индекс на zernio_logs,
-- снят дубль уникального индекса bot_users, у двух функций зафиксирован search_path.
-- Применяет Яков своим словом; пока не применена, всё работает как сейчас.
-- Откат: 23-1-indexes-advisor.down.sql.

-- Журнал zernio_logs ищется по началу event_id: обращения (`ticket:`), outbox,
-- розыгрыши, сводки, второй шаг Zernio (`two-step-dm:`). У базы правила сравнения
-- en_US, поэтому обычный индекс по event_id для `like 'префикс%'` не годится, и
-- Postgres перебирает весь журнал магазина (у живого магазина больше 11 тыс. строк за
-- неделю, 1,7 с, statement timeout 07.10, Sentry FROGFLOW-V2-K). text_pattern_ops
-- сравнивает побайтно и отдаёт префикс по индексу. Первым идёт bot_id: под ролью
-- арендатора RLS всегда добавляет bot_id = current_bot_id().
CREATE INDEX IF NOT EXISTS idx_zernio_logs_bot_event_prefix
  ON zernio_logs (bot_id, event_id text_pattern_ops);

-- Два одинаковых уникальных индекса (bot_id, telegram_id): каждая запись в bot_users
-- обновляет оба. Ни один не связан с ограничением (pg_constraint пуст), код на имя не
-- ссылается (upsert указывает колонки), уникальность держит оставшийся
-- bot_users_bot_telegram_id_key.
DROP INDEX IF EXISTS bot_users_bot_telegram_idx;

-- Функции без зафиксированного search_path (советник: function_search_path_mutable).
-- reset_orders_sequence — SECURITY DEFINER, обращается к public.orders полным именем;
-- платформенный триггер таблиц не трогает. Встроенные функции (setval,
-- pg_get_serial_sequence) берутся из pg_catalog и при пустом search_path.
ALTER FUNCTION public.reset_orders_sequence() SET search_path = '';
ALTER FUNCTION public.platform_threads_seller_status() SET search_path = '';
