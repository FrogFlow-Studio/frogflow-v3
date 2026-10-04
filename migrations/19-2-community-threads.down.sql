-- Откат 19-2: удаляет только таблицы сообщества (темы, ответы, жалобы). Остальное не трогает.
drop table if exists public.community_reports;
drop table if exists public.community_posts;
drop table if exists public.community_threads;
