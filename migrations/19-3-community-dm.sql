-- 19-3 · Сообщество авторов: личные сообщения между авторами (путь С, пункт С3).
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица, существующее не трогается (v1 пользуется той же базой).
-- Применяет Яков своим словом. Пока таблицы нет, кнопок личных сообщений нет, код не падает.
-- Откат: 19-3-community-dm.down.sql

create table if not exists public.community_dm (
  id           uuid primary key default gen_random_uuid(),
  from_bot_id  uuid not null references public.bots (id) on delete cascade,
  to_bot_id    uuid not null references public.bots (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  read_at      timestamptz,
  -- Отметка «продавцу сообщили в Telegram»: ставится условным обновлением (where notified_at is null)
  -- до отправки, поэтому на одно сообщение уходит одно уведомление, даже если вызвали дважды.
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (from_bot_id <> to_bot_id)
);
create index if not exists community_dm_to_idx
  on public.community_dm (to_bot_id, created_at desc, id desc);
create index if not exists community_dm_pair_idx
  on public.community_dm (from_bot_id, to_bot_id, created_at desc, id desc);
create index if not exists community_dm_unread_idx
  on public.community_dm (to_bot_id) where read_at is null;

-- Как у 19-2: RLS включена, политик нет — видит только service_role; доступ через core/community
-- после проверки согласия обоих авторов.
alter table public.community_dm enable row level security;
revoke all on public.community_dm from anon, authenticated, tenant_bot;
grant select, insert, update, delete on public.community_dm to service_role;
