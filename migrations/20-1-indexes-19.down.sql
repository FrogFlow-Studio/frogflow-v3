-- Откат 20-1: только индексы, данные не затрагиваются.
DROP INDEX IF EXISTS idx_platform_news_votes_news;
DROP INDEX IF EXISTS idx_platform_threads_first_response;
DROP INDEX IF EXISTS idx_marketplace_shops_name;
DROP INDEX IF EXISTS community_dm_from_idx;
