-- v4/012: выдача материалов фоновой задачей «deliver» (этап 3 → исполнитель).
-- Только схема v4. Применяет Яков в SQL-редакторе Supabase после 011.
-- Ничего не запускает: исполнитель задач вызывается кроном только после переключения.

-- Отметка «начали отправлять» до отправки: второй исполнитель (повтор задачи после
-- истёкшей аренды) не шлёт покупателю второй раз (CLAUDE.md: «один раз» — запись до отправки).
create table v4.delivery_claims (
  bot_id uuid not null,
  access_id uuid not null,
  channel text not null check (channel in ('telegram', 'instagram', 'whatsapp', 'email')),
  claimed_at timestamptz not null default now(),
  primary key (access_id, channel),
  foreign key (bot_id, access_id) references v4.access (bot_id, id)
);

-- Что и куда выдать по доступу: товар, язык покупателя и его последний канал переписки.
-- null — доступа нет. Канал null — писать некуда (дело продавцу).
create or replace function v4.delivery_plan(p_bot_id uuid, p_access_id uuid)
returns jsonb language sql stable as $$
  with ch as (
    select bc.channel, bc.external_id from v4.buyer_channels bc, v4.access a
    where a.id = p_access_id and a.bot_id = p_bot_id
      and bc.bot_id = a.bot_id and bc.buyer_id = a.buyer_id and bc.channel in ('telegram', 'instagram', 'whatsapp')
    order by bc.created_at desc, bc.channel, bc.external_id
    limit 1)
  select jsonb_build_object(
    'access_id', a.id, 'status', a.status, 'kind', a.kind, 'buyer_id', a.buyer_id, 'order_id', a.order_id,
    'ends_at', a.ends_at,
    'title', coalesce(par.title, p.title) || coalesce(' · ' || p.variant_label, ''),
    'language', coalesce(b.language, 'ru'),
    'channel', ch.channel, 'external_id', ch.external_id,
    'delivered', exists (select 1 from v4.deliveries d where d.access_id = a.id and d.channel = ch.channel),
    'claimed_at', (select c.claimed_at from v4.delivery_claims c where c.access_id = a.id and c.channel = ch.channel))
  from v4.access a
  join v4.products p on p.id = a.product_id
  left join v4.products par on par.id = p.parent_id
  join v4.buyers b on b.bot_id = a.bot_id and b.id = a.buyer_id
  left join ch on true
  where a.id = p_access_id and a.bot_id = p_bot_id
$$;

create or replace function v4.claim_delivery(p_bot_id uuid, p_access_id uuid, p_channel text)
returns boolean language plpgsql as $$
declare
  ok boolean;
begin
  insert into v4.delivery_claims (bot_id, access_id, channel) values (p_bot_id, p_access_id, p_channel)
  on conflict (access_id, channel) do nothing
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Исполнитель берёт только свои виды задач (выдача — одно, приглашение в клуб — другое).
-- Следующие миграции, которые делают «grant execute on all functions … to tenant_bot»,
-- отзывают у арендатора claim_jobs(integer, interval, timestamptz, text[]) — новую подпись.
drop function if exists v4.claim_jobs(integer, interval, timestamptz);
create function v4.claim_jobs(
  p_limit integer default 20, p_lease interval default '2 minutes', p_now timestamptz default now(),
  p_kinds text[] default null
) returns setof v4.jobs language plpgsql as $$
begin
  update v4.jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    last_error = 'аренда истекла', lease_until = null,
    done_at = case when attempts >= max_attempts then p_now end
  where status = 'running' and lease_until < p_now;
  return query
  update v4.jobs j set status = 'running', attempts = j.attempts + 1, lease_until = p_now + p_lease
  where j.id in (
    select id from v4.jobs
    where status = 'queued' and run_at <= p_now and (p_kinds is null or kind = any (p_kinds))
    order by run_at, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;

alter table v4.delivery_claims enable row level security;
revoke all on v4.delivery_claims from public, anon, authenticated, tenant_bot;
grant select, insert on v4.delivery_claims to service_role;
revoke all on function v4.delivery_plan(uuid, uuid), v4.claim_delivery(uuid, uuid, text),
  v4.claim_jobs(integer, interval, timestamptz, text[]) from public, anon, authenticated, tenant_bot;
grant execute on function v4.delivery_plan(uuid, uuid), v4.claim_delivery(uuid, uuid, text),
  v4.claim_jobs(integer, interval, timestamptz, text[]) to service_role;

-- Проверка (должно вернуть 1):
-- select count(*) from pg_tables where schemaname = 'v4' and tablename = 'delivery_claims';
