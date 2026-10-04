-- Откат 19-5: удаляет только то, что создала миграция 19-5. Новости и голоса
-- пропадут безвозвратно — сначала выгрузить, если они нужны.
DROP TABLE IF EXISTS platform_news_votes;
DROP TABLE IF EXISTS platform_news_reads;
DROP TABLE IF EXISTS platform_news;
