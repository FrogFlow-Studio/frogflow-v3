-- v4/001: отдельная схема v4 в той же базе (решение 30).
-- Только добавляет схему; таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
create schema if not exists v4;

-- Доступ: сервисная роль (кроны, переезд) и роль арендатора tenant_bot (панель,
-- бот; та же, что в v3, с bot_id в JWT) —
-- права на таблицы выдаёт каждая следующая миграция отдельно.
grant usage on schema v4 to service_role, tenant_bot;

-- Проверка (должна вернуть одну строку «v4»):
-- select nspname from pg_namespace where nspname = 'v4';
