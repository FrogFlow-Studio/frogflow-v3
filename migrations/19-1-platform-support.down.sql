-- Откат 19-1: удаляет только то, что создала миграция 19-1. Переписка с
-- поддержкой пропадёт безвозвратно — сначала выгрузить, если она нужна.
DROP TABLE IF EXISTS platform_thread_notes;
DROP TABLE IF EXISTS platform_messages;
DROP TABLE IF EXISTS platform_threads;
DROP FUNCTION IF EXISTS platform_threads_seller_status();
