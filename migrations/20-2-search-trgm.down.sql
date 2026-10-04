-- Откат 20-2: только индексы. Расширение pg_trgm остаётся: им могут пользоваться другие.
DROP INDEX IF EXISTS idx_marketplace_items_search_trgm;
DROP INDEX IF EXISTS idx_marketplace_shops_name_trgm;
