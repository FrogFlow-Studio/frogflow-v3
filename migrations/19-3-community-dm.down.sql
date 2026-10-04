-- Откат 19-3: удаляет только таблицу личных сообщений сообщества.
drop table if exists public.community_dm;
