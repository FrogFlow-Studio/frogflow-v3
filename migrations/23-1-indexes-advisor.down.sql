-- Откат 23-1: данные не затрагиваются.
DROP INDEX IF EXISTS idx_zernio_logs_bot_event_prefix;
CREATE UNIQUE INDEX IF NOT EXISTS bot_users_bot_telegram_idx ON bot_users (bot_id, telegram_id);
ALTER FUNCTION public.reset_orders_sequence() RESET search_path;
ALTER FUNCTION public.platform_threads_seller_status() RESET search_path;
