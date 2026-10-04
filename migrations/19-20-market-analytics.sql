-- 19-20 · Аналитика площадки FrogFlow (путь В, пункт В20).
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица, существующее не трогается (база общая с v1).
-- Применяет Яков своим словом. Пока таблицы нет, аналитика пишет «нет данных», код не падает.
-- Откат: 19-20-market-analytics.down.sql
--
-- Без личных данных: ни cookie, ни адреса, ни устройства. «Один человек за час считается один раз»
-- обеспечивает dedupe: хеш (секрет платформы, час, адрес, браузер) — он меняется каждый час,
-- по нему нельзя связать посещения разных часов. Уникальный индекс не даёт записать повтор.
-- Строки старше 40 дней удаляются при записи.

create table if not exists public.market_events (
  id          uuid primary key default gen_random_uuid(),
  -- visit — открыли /market; search — искали; empty — искали и ничего не нашли; click — перешли в магазин
  kind        text not null check (kind in ('visit', 'search', 'empty', 'click')),
  -- search/empty: запрос (нижний регистр, до 80 знаков); click: id магазина; visit: пусто
  key         text not null default '' check (char_length(key) <= 80),
  -- начало часа, к которому относится событие
  bucket      timestamptz not null,
  dedupe      text not null check (char_length(dedupe) between 16 and 64),
  created_at  timestamptz not null default now(),
  unique (kind, key, bucket, dedupe)
);
create index if not exists market_events_created_idx on public.market_events (created_at);
create index if not exists market_events_kind_key_idx on public.market_events (kind, key, created_at);

-- Строки читает и пишет только платформа (service_role): политик нет.
alter table public.market_events enable row level security;
revoke all on public.market_events from anon, authenticated, tenant_bot;
grant select, insert, update, delete on public.market_events to service_role;
