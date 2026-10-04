-- 19-2 · Сообщество авторов: темы, ответы, жалобы (путь С, пункт С2).
-- ТОЛЬКО ДОБАВЛЕНИЕ: три новые таблицы, существующее не трогается (v1 пользуется той же базой).
-- Применяет Яков своим словом. Пока таблиц нет, код сообщества отвечает «скоро» и не падает.
-- Откат: 19-2-community-threads.down.sql

create table if not exists public.community_threads (
  id            uuid primary key default gen_random_uuid(),
  bot_id        uuid not null references public.bots (id) on delete cascade,
  section       text not null check (section in ('questions', 'experience', 'offers')),
  -- Только для раздела «Ищу / предлагаю».
  topic         text check (topic in ('packaging', 'photo', 'delivery', 'contractors')),
  title         text not null check (char_length(title) between 3 and 140),
  body          text not null check (char_length(body) between 1 and 4000),
  posts_count   integer not null default 0,
  last_post_at  timestamptz not null default now(),
  hidden        boolean not null default false,
  hidden_by     text check (hidden_by in ('operator', 'reports')),
  hidden_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists community_threads_list_idx
  on public.community_threads (section, last_post_at desc, id desc) where not hidden;
create index if not exists community_threads_bot_idx on public.community_threads (bot_id, created_at desc);

create table if not exists public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.community_threads (id) on delete cascade,
  bot_id      uuid not null references public.bots (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  hidden      boolean not null default false,
  hidden_by   text check (hidden_by in ('operator', 'reports')),
  hidden_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists community_posts_thread_idx on public.community_posts (thread_id, created_at, id);
create index if not exists community_posts_bot_idx on public.community_posts (bot_id, created_at desc);

-- Жалоба: на тему (post_id пусто) или на ответ. Один автор жалуется на одно и то же один раз.
create table if not exists public.community_reports (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references public.bots (id) on delete cascade,
  thread_id   uuid not null references public.community_threads (id) on delete cascade,
  post_id     uuid references public.community_posts (id) on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 300),
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now()
);
create unique index if not exists community_reports_once_thread_idx
  on public.community_reports (bot_id, thread_id) where post_id is null;
create unique index if not exists community_reports_once_post_idx
  on public.community_reports (bot_id, post_id) where post_id is not null;
create index if not exists community_reports_open_idx
  on public.community_reports (created_at, id) where status = 'open';

-- Данные общие для авторов, а не «магазинные»: RLS включена, политик нет — таблицы видит только
-- service_role (как operator_settings). Читает и пишет их код платформы (core/community) после
-- проверки согласия автора; арендаторская роль напрямую не может ничего.
alter table public.community_threads enable row level security;
alter table public.community_posts   enable row level security;
alter table public.community_reports enable row level security;
revoke all on public.community_threads, public.community_posts, public.community_reports
  from anon, authenticated, tenant_bot;
grant select, insert, update, delete
  on public.community_threads, public.community_posts, public.community_reports to service_role;
