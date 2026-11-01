-- v4/004: выдача и доступы (этап 3; решения 11, 12, 19, 94, 96, 101).
-- Только схема v4. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- Главное:
--  * Файл, клуб, курс — один «доступ» со сроком (решение 11). У файла срока нет,
--    у клуба есть; продление клуба начинается с конца текущего срока.
--  * Вариант — отдельная строка товара со своим файлом (класс, язык) или сроком
--    клуба (решение 94). У товара с вариантами покупают только вариант.
--  * Оплаченный заказ сам выдаёт доступ ровно один раз (уникальный ключ на
--    строку заказа) и ставит задачи выдачи в очередь. Сбой выдачи — дело (43).
--  * Кабинет покупателя по ссылке (решение 12): в базе только sha256 токена.
--  * Почта по желанию (решение 96): только ещё один канал выдачи, ничего не открывает.
--  * Место под файлы — лимит магазина и кандидаты на чистку (решение 19).

-- ── варианты и файлы товара ─────────────────────────────────────────────────
alter table v4.products
  add column parent_id uuid,
  add column variant_label text,
  add column storage_path text check (storage_path <> ''),
  add column file_bytes bigint check (file_bytes >= 0),
  add column term interval check (term > interval '0'),
  add column club_chat_id text,
  add column archived_at timestamptz,
  add constraint products_parent foreign key (bot_id, parent_id) references v4.products (bot_id, id),
  add constraint products_variant_label check ((parent_id is null) = (variant_label is null)),
  add constraint products_term_club check (term is null or kind = 'club'),
  add constraint products_archived check ((status = 'archived') = (archived_at is not null));
create index products_parent_idx on v4.products (parent_id) where parent_id is not null;

-- Товар с вариантами не продаётся сам; вариант архивного товара — тоже нет.
create or replace function v4.order_item_sellable() returns trigger language plpgsql as $$
begin
  if exists (select 1 from v4.products c where c.parent_id = new.product_id and c.status = 'active') then
    raise exception using errcode = 'P0001', message = 'v4:choose_variant';
  end if;
  if exists (select 1 from v4.products v join v4.products p on p.id = v.parent_id
             where v.id = new.product_id and p.status <> 'active') then
    raise exception using errcode = 'P0001', message = 'v4:product_unavailable';
  end if;
  return new;
end $$;
create trigger order_items_sellable before insert on v4.order_items
  for each row execute function v4.order_item_sellable();

-- Почта покупателя: только канал выдачи, не подтверждена, ничего не открывает (96).
alter table v4.buyers add column email text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Лимит места под файлы магазина (решение 19), по умолчанию 5 ГБ.
alter table v4.shops add column storage_limit_bytes bigint not null default 5368709120 check (storage_limit_bytes >= 0);

-- ── доступ ──────────────────────────────────────────────────────────────────
create table v4.access (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  buyer_id uuid not null,
  product_id uuid not null,
  order_id uuid,
  order_item_id bigint unique references v4.order_items (id),
  kind text not null check (kind in ('file', 'club')),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  source text not null check (source in ('order', 'migration', 'manual')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  unique (bot_id, id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  foreign key (bot_id, product_id) references v4.products (bot_id, id),
  foreign key (bot_id, order_id) references v4.orders (bot_id, id),
  check ((kind = 'club') = (ends_at is not null)),
  check (ends_at is null or ends_at > starts_at),
  check ((source = 'order') = (order_item_id is not null)),
  check ((status = 'active') = (closed_at is null)),
  check (status <> 'revoked' or coalesce(close_reason, '') <> '')
);
create index access_buyer on v4.access (bot_id, buyer_id, status);
create index access_club_ends on v4.access (ends_at) where status = 'active' and kind = 'club';

-- Клуб, к которому относится товар: сам товар или его родитель (вариант = срок).
create or replace function v4.club_root(p_product_id uuid) returns uuid language sql stable as $$
  select coalesce(p.parent_id, p.id) from v4.products p where p.id = p_product_id
$$;

-- Выдать доступ по оплаченному заказу. Повторный вызов ничего не добавляет.
create or replace function v4.grant_access_for_order(p_bot_id uuid, p_order_id uuid, p_created_by text)
returns integer language plpgsql as $$
declare
  o v4.orders;
  it record;
  aid uuid;
  st timestamptz;
  n integer := 0;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if o.status <> 'open' then return 0; end if;
  for it in
    select oi.id as item_id, p.id as product_id, p.kind, p.term, v4.club_root(p.id) as root
    from v4.order_items oi join v4.products p on p.id = oi.product_id
    where oi.order_id = o.id order by oi.id
  loop
    if it.kind = 'club' then
      -- Продление: с конца текущего срока этого клуба, если он ещё идёт.
      select greatest(now(), coalesce(max(a.ends_at), now())) into st
      from v4.access a
      where a.bot_id = p_bot_id and a.buyer_id = o.buyer_id and a.status = 'active' and a.kind = 'club'
        and v4.club_root(a.product_id) = it.root;
      insert into v4.access (bot_id, buyer_id, product_id, order_id, order_item_id, kind, source, starts_at, ends_at, created_by)
      values (p_bot_id, o.buyer_id, it.product_id, o.id, it.item_id, 'club', 'order', st,
              st + coalesce(it.term, interval '30 days'), p_created_by)
      on conflict (order_item_id) do nothing
      returning id into aid;
      if aid is not null then
        perform v4.enqueue_job('club_invite', 'club_invite:' || aid, p_bot_id,
                               jsonb_build_object('access_id', aid, 'club_id', it.root));
      end if;
    else
      insert into v4.access (bot_id, buyer_id, product_id, order_id, order_item_id, kind, source, created_by)
      values (p_bot_id, o.buyer_id, it.product_id, o.id, it.item_id, 'file', 'order', p_created_by)
      on conflict (order_item_id) do nothing
      returning id into aid;
    end if;
    if aid is not null then
      perform v4.enqueue_job('deliver', 'deliver:' || aid, p_bot_id, jsonb_build_object('access_id', aid));
      n := n + 1;
    end if;
  end loop;
  update v4.orders set status = 'fulfilled' where id = o.id and status = 'open';
  if found then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'fulfilled', jsonb_build_object('access_granted', n), p_created_by);
  end if;
  return n;
end $$;

-- Оплата закрыла заказ → доступ. Деньги по истёкшему/отменённому заказу доступ не выдают:
-- это дело продавцу (этап 2), он решает.
create or replace function v4.access_from_order_event() returns trigger language plpgsql as $$
begin
  if new.kind = 'paid' then
    perform v4.grant_access_for_order(new.bot_id, new.order_id, new.created_by);
  end if;
  return new;
end $$;
create trigger order_events_access after insert on v4.order_events
  for each row execute function v4.access_from_order_event();

-- Отозвать доступ (возврат, отмена оплаты): только с причиной; клуб — задача убрать из группы.
create or replace function v4.revoke_access(p_bot_id uuid, p_access_id uuid, p_reason text, p_created_by text)
returns boolean language plpgsql as $$
declare
  a v4.access;
begin
  if coalesce(p_reason, '') = '' then raise exception using errcode = 'P0001', message = 'v4:reason_required'; end if;
  update v4.access set status = 'revoked', closed_at = now(), close_reason = p_reason
  where id = p_access_id and bot_id = p_bot_id and status = 'active'
  returning * into a;
  if not found then return false; end if;
  if a.kind = 'club' then
    perform v4.enqueue_job('club_remove', 'club_remove:' || a.id, p_bot_id,
                           jsonb_build_object('access_id', a.id, 'club_id', v4.club_root(a.product_id)));
  end if;
  return true;
end $$;

-- Клубы: истечение срока и напоминание о продлении за 3 дня, по одному разу.
-- Из группы не убираем, если у покупателя есть следующий оплаченный срок этого клуба.
create or replace function v4.expire_access(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  a record;
  expired integer := 0;
  reminded integer := 0;
begin
  for a in
    select * from v4.access
    where status = 'active' and kind = 'club' and ends_at <= p_now
    order by ends_at, id limit 1000
  loop
    update v4.access set status = 'expired', closed_at = p_now, close_reason = 'Срок закончился'
    where id = a.id and status = 'active';
    if found then
      expired := expired + 1;
      if not exists (select 1 from v4.access n
                     where n.bot_id = a.bot_id and n.buyer_id = a.buyer_id and n.status = 'active'
                       and n.kind = 'club' and n.id <> a.id
                       and v4.club_root(n.product_id) = v4.club_root(a.product_id)
                       and n.starts_at <= p_now and n.ends_at > p_now) then
        perform v4.enqueue_job('club_remove', 'club_remove:' || a.id, a.bot_id,
                               jsonb_build_object('access_id', a.id, 'club_id', v4.club_root(a.product_id)));
      end if;
    end if;
  end loop;
  for a in
    select x.* from v4.access x
    where x.status = 'active' and x.kind = 'club' and x.ends_at > p_now and x.ends_at <= p_now + interval '3 days'
      and not exists (select 1 from v4.access n
                      where n.bot_id = x.bot_id and n.buyer_id = x.buyer_id and n.status = 'active'
                        and n.kind = 'club' and n.id <> x.id and n.starts_at >= x.ends_at
                        and v4.club_root(n.product_id) = v4.club_root(x.product_id))
    order by x.ends_at, x.id limit 1000
  loop
    if v4.notify(a.bot_id, 'buyer', 'now', 'club_renew_reminder', 'renew:' || a.id, null, a.order_id,
                 jsonb_build_object('access_id', a.id, 'buyer_id', a.buyer_id, 'ends_at', a.ends_at)) then
      reminded := reminded + 1;
    end if;
  end loop;
  return jsonb_build_object('expired', expired, 'reminded', reminded);
end $$;

-- ── выдача: результат по каналу ─────────────────────────────────────────────
create table v4.deliveries (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  access_id uuid not null,
  channel text not null check (channel in ('telegram', 'instagram', 'whatsapp', 'email')),
  status text not null check (status in ('sent', 'failed', 'unknown')),
  error text,
  created_at timestamptz not null default now(),
  unique (access_id, channel),
  foreign key (bot_id, access_id) references v4.access (bot_id, id)
);

-- Итог выдачи по каналу (первый итог по каналу окончательный: «могло дойти» не повторяем).
-- Неудача или неизвестность → дело продавцу «сбой выдачи» (решение 43); успех закрывает его.
create or replace function v4.delivery_result(
  p_bot_id uuid, p_access_id uuid, p_channel text, p_status text, p_error text default null
) returns boolean language plpgsql as $$
declare
  a v4.access;
  did bigint;
begin
  select * into a from v4.access where id = p_access_id and bot_id = p_bot_id;
  if not found then raise exception using errcode = 'P0001', message = 'v4:access_not_found'; end if;
  insert into v4.deliveries (bot_id, access_id, channel, status, error)
  values (p_bot_id, p_access_id, p_channel, p_status, p_error)
  on conflict (access_id, channel) do nothing
  returning id into did;
  if did is null then return false; end if;
  if p_status = 'sent' then
    perform v4.close_cases_for(p_bot_id, 'delivery_failed', 'access:' || p_access_id, 'Выдано: ' || p_channel, 'delivery');
  else
    perform v4.open_case(p_bot_id, 'delivery_failed', 'access:' || p_access_id, 'delivery', a.buyer_id, a.order_id,
                         jsonb_build_object('access_id', p_access_id, 'channel', p_channel, 'status', p_status, 'error', p_error));
  end if;
  return true;
end $$;

-- ── кабинет покупателя по ссылке (решение 12) ──────────────────────────────
create table v4.cabinet_links (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  bot_id uuid not null,
  buyer_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  last_used_at timestamptz,
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id)
);
create index cabinet_links_buyer on v4.cabinet_links (bot_id, buyer_id);

-- Новая ссылка: код создаёт случайный токен, в базу кладёт только его sha256.
create or replace function v4.issue_cabinet_link(p_bot_id uuid, p_buyer_id uuid, p_token_sha256 text)
returns timestamptz language sql as $$
  insert into v4.cabinet_links (token_sha256, bot_id, buyer_id)
  values (lower(p_token_sha256), p_bot_id, p_buyer_id)
  returning expires_at
$$;

-- Что видит покупатель по ссылке: только свои действующие доступы. Неверная или старая ссылка — пусто.
create or replace function v4.cabinet_items(p_bot_id uuid, p_token_sha256 text, p_now timestamptz default now())
returns table (access_id uuid, title text, variant_label text, kind text, ends_at timestamptz, storage_path text)
language plpgsql as $$
declare
  l v4.cabinet_links;
begin
  update v4.cabinet_links cl set last_used_at = p_now
  where cl.token_sha256 = lower(p_token_sha256) and cl.bot_id = p_bot_id and cl.expires_at > p_now
  returning * into l;
  if not found then return; end if;
  return query
  select a.id, coalesce(par.title, p.title), p.variant_label, a.kind, a.ends_at, p.storage_path
  from v4.access a
  join v4.products p on p.id = a.product_id
  left join v4.products par on par.id = p.parent_id
  where a.bot_id = p_bot_id and a.buyer_id = l.buyer_id and a.status = 'active'
    and (a.ends_at is null or a.ends_at > p_now)
  order by a.created_at desc, a.id;
end $$;

-- ── место под файлы (решение 19) ───────────────────────────────────────────
create view v4.storage_usage with (security_invoker = true) as
select s.bot_id, s.storage_limit_bytes,
  coalesce((select sum(p.file_bytes) from v4.products p where p.bot_id = s.bot_id and p.storage_path is not null), 0)::bigint as used_bytes
from v4.shops s;

-- Файлы архивных товаров старше 90 дней, которых нет в действующих доступах, — кандидаты на чистку.
create view v4.storage_cleanup with (security_invoker = true) as
select p.bot_id, p.id as product_id, p.storage_path, p.file_bytes, p.archived_at
from v4.products p
where p.status = 'archived' and p.archived_at < now() - interval '90 days' and p.storage_path is not null
  and not exists (select 1 from v4.access a where a.product_id = p.id and a.status = 'active');

create or replace function v4.storage_room(p_bot_id uuid, p_bytes bigint) returns boolean
language sql stable as $$
  select u.used_bytes + p_bytes <= u.storage_limit_bytes from v4.storage_usage u where u.bot_id = p_bot_id
$$;

-- ── планировщик: добавились доступы ────────────────────────────────────────
create or replace function v4.tick(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  expired integer := 0;
  s record;
begin
  for s in select bot_id from v4.shops order by bot_id loop
    expired := expired + v4.expire_orders(s.bot_id, p_now);
  end loop;
  return jsonb_build_object(
    'cases', v4.tick_cases(p_now),
    'orders_expired', expired,
    'access', v4.expire_access(p_now),
    'notifications_unknown', v4.expire_notification_leases(p_now));
end $$;

-- Задачи ставят и триггеры под ролью арендатора (оплата → выдача), а таблицу задач
-- арендатор не видит. Поэтому постановка — от владельца схемы, но только для своего bot_id.
create or replace function v4.enqueue_job(
  p_kind text, p_dedupe_key text, p_bot_id uuid default null,
  p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default now()
) returns boolean language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  jid bigint;
begin
  if v4.current_bot_id() is not null and p_bot_id is distinct from v4.current_bot_id() then
    raise exception using errcode = 'P0001', message = 'v4:foreign_bot';
  end if;
  insert into v4.jobs (bot_id, kind, dedupe_key, payload, run_at)
  values (p_bot_id, p_kind, p_dedupe_key, p_payload, p_run_at)
  on conflict (kind, dedupe_key) do nothing
  returning id into jid;
  return jid is not null;
end $$;

-- ── права ──────────────────────────────────────────────────────────────────
alter table v4.access enable row level security;
alter table v4.deliveries enable row level security;
alter table v4.cabinet_links enable row level security;
create policy tenant_isolation on v4.access for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.deliveries for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
-- Ссылки кабинета ведёт только сервисная роль: арендатор их не читает.

revoke all on v4.access, v4.deliveries, v4.cabinet_links from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.access, v4.deliveries, v4.cabinet_links to service_role;
grant select on v4.storage_usage, v4.storage_cleanup to service_role, tenant_bot;
grant select, insert on v4.access, v4.deliveries to tenant_bot;
grant update (status, closed_at, close_reason) on v4.access to tenant_bot;
grant update (email) on v4.buyers to tenant_bot;

revoke all on all functions in schema v4 from public, anon, authenticated;
grant execute on all functions in schema v4 to service_role, tenant_bot;
revoke execute on function v4.tick(timestamptz), v4.tick_cases(timestamptz), v4.claim_notifications(text, integer, timestamptz),
  v4.finish_notification(bigint, text, text), v4.expire_notification_leases(timestamptz),
  v4.claim_jobs(integer, interval, timestamptz),
  v4.finish_job(bigint, boolean, text, interval), v4.expire_access(timestamptz),
  v4.cabinet_items(uuid, text, timestamptz), v4.issue_cabinet_link(uuid, uuid, text) from tenant_bot;

-- Проверка (должно вернуть 3 новые таблицы и колонку parent_id у товаров):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename in ('access', 'deliveries', 'cabinet_links')) as tables,
--        (select count(*) from information_schema.columns where table_schema = 'v4' and table_name = 'products' and column_name = 'parent_id') as parent_col;
