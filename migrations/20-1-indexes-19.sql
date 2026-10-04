-- 20-1: индексы под запросы партии 19. Партия 20, пункт С2.
-- ТОЛЬКО ДОБАВЛЕНИЕ: новые индексы; таблицы, колонки и существующие индексы не
-- трогаются (база общая с v1, v1 этих таблиц не видит). Данные не меняются.
-- Применяется ПОСЛЕ миграций 19-* (индексы на их таблицах). Применяет Яков своим словом;
-- пока не применена, всё работает, только медленнее
-- на больших таблицах. Откат: 20-1-indexes-19.down.sql.

-- Голоса за вариант опроса: оператор считает итоги по новости (news_id), а
-- первичный ключ (bot_id, news_id) начинается с магазина и по новости не помогает.
CREATE INDEX IF NOT EXISTS idx_platform_news_votes_news
  ON platform_news_votes (news_id, bot_id);

-- «Обычно отвечаем за N часов» и сводка ответов читают обращения с первым
-- ответом за 30 дней (first_response_at >= дата): без индекса это просмотр всей таблицы.
CREATE INDEX IF NOT EXISTS idx_platform_threads_first_response
  ON platform_threads (first_response_at)
  WHERE first_response_at IS NOT NULL;

-- Каталог площадки без фильтров идёт по порядку name, bot_id (страницы «Показать ещё»).
CREATE INDEX IF NOT EXISTS idx_marketplace_shops_name
  ON marketplace_shops (name, bot_id);

-- Личные сообщения сообщества: лимит «сколько отправил за период» (from_bot_id,
-- created_at) и входящие/исходящие по ИЛИ; существующие индексы начинаются с to_bot_id
-- или с пары, поэтому отправителя по времени не покрывают.
CREATE INDEX IF NOT EXISTS community_dm_from_idx
  ON community_dm (from_bot_id, created_at DESC, id DESC);
