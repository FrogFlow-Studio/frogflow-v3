-- 19-4 · Сообщество авторов: совместные акции магазинов (путь С, пункт С5).
-- ТОЛЬКО ДОБАВЛЕНИЕ: две новые таблицы, существующее не трогается (v1 пользуется той же базой).
-- Применяет Яков своим словом. Пока таблиц нет, раздела «Совместные акции» нет, код не падает.
-- Откат: 19-4-joint-promos.down.sql
--
-- Деньги платформа не собирает и не делит. У каждого магазина — свой обычный промокод
-- (строка promo_codes этого магазина) и своя скидка за свой счёт; здесь только договорённость:
-- кто участвует, до какой даты и какой код у кого.

create table if not exists public.joint_promos (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references public.bots (id) on delete cascade,
  title         text not null check (char_length(title) between 3 and 80),
  -- Акция стартует, когда согласились все участники; заканчивается в ends_at.
  ends_at       timestamptz not null,
  status        text not null default 'proposed' check (status in ('proposed', 'active', 'cancelled')),
  activated_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists joint_promos_created_by_idx on public.joint_promos (created_by, created_at desc);

create table if not exists public.joint_promo_members (
  id                uuid primary key default gen_random_uuid(),
  promo_id          uuid not null references public.joint_promos (id) on delete cascade,
  bot_id            uuid not null references public.bots (id) on delete cascade,
  status            text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  -- Условия этого магазина: их задаёт только он сам при согласии, остальные их не меняют.
  code              text,
  discount_percent  integer check (discount_percent is null or discount_percent between 1 and 90),
  conditions        text check (conditions is null or char_length(conditions) <= 300),
  -- Строка promo_codes этого магазина (создаётся неактивной, включается, когда согласились все).
  promo_code_id     uuid,
  -- Отметка «о приглашении сообщили в Telegram»: условное обновление до отправки, одно уведомление.
  notified_at       timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (promo_id, bot_id)
);
create index if not exists joint_promo_members_bot_idx on public.joint_promo_members (bot_id, created_at desc);

-- Как у 19-2: RLS включена, политик нет — видит только service_role; доступ через core/community.
alter table public.joint_promos enable row level security;
alter table public.joint_promo_members enable row level security;
revoke all on public.joint_promos, public.joint_promo_members from anon, authenticated, tenant_bot;
grant select, insert, update, delete on public.joint_promos, public.joint_promo_members to service_role;
