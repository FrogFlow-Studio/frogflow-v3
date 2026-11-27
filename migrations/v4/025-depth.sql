-- v4/025: глубина без живой модели. Применяет Яков после 024.
-- Заявка входящего (повтор вебхука не создаёт второй заказ), ответ продавца
-- своим текстом, последний шаг выдачи, поиск с триграммами если расширение
-- уже включено, кандидаты экзамена списком. Расширение pg_trgm этот файл
-- не создаёт: его включает Яков, без него остаётся поиск одной опечатки.

create table v4.inbound_claims (
  bot_id uuid not null references v4.shops (bot_id),
  channel text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (bot_id, channel, external_id)
);

create or replace function v4.claim_inbound(p_bot_id uuid, p_channel text, p_external_id text)
returns boolean language plpgsql as $$
declare wrote integer;
begin
  if coalesce(p_external_id, '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  insert into v4.inbound_claims (bot_id, channel, external_id)
  values (p_bot_id, p_channel, p_external_id)
  on conflict do nothing;
  get diagnostics wrote = row_count;
  return wrote = 1;
end $$;

create table v4.seller_replies (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  case_id uuid not null,
  text text not null check (length(text) between 1 and 4000),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (bot_id, case_id),
  foreign key (bot_id, case_id) references v4.cases (bot_id, id)
);

create or replace function v4.seller_reply(
  p_bot_id uuid, p_case_id uuid, p_text text, p_by text
) returns boolean language plpgsql as $$
declare wrote integer;
begin
  if coalesce(btrim(p_text), '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:reason_required';
  end if;
  if not exists (
    select 1 from v4.cases where bot_id = p_bot_id and id = p_case_id and status = 'open'
  ) then
    raise exception using errcode = 'P0001', message = 'v4:reply_closed';
  end if;
  insert into v4.seller_replies (bot_id, case_id, text, created_by)
  values (p_bot_id, p_case_id, left(btrim(p_text), 4000), p_by)
  on conflict (bot_id, case_id) do nothing;
  get diagnostics wrote = row_count;
  return wrote = 1;
end $$;

create or replace function v4.last_fulfillment_step(p_bot_id uuid, p_order_id uuid)
returns text language sql stable as $$
  select step from v4.fulfillment_steps
  where bot_id = p_bot_id and order_id = p_order_id
  order by created_at desc
  limit 1
$$;

create or replace function v4.catalog_search_mode() returns text
language sql stable as $$
  select case
    when exists (select 1 from pg_extension where extname = 'pg_trgm') then 'trgm'
    else 'typo'
  end
$$;

-- Ветка similarity исполняется только когда расширение есть: без него
-- функция не ссылается на него при создании и зовёт поиск одной опечатки.
create or replace function v4.find_products_wide(
  p_bot_id uuid, p_query text, p_limit integer default 8
) returns table (
  product_id uuid, title text, variant_label text, kind text, has_variants boolean
) language plpgsql as $$
begin
  if v4.catalog_search_mode() = 'trgm' then
    return query execute $q$
      select p.id, p.title, p.variant_label, p.kind,
        exists (select 1 from v4.products c where c.parent_id = p.id and c.status = 'active')
      from v4.products p
      where p.bot_id = $1 and p.status = 'active' and p.parent_id is null
        and ($2 = '' or similarity(lower(p.title), lower($2)) > 0.2)
      order by similarity(lower(p.title), lower($2)) desc, p.title, p.id
      limit $3
    $q$ using p_bot_id, coalesce(p_query, ''), greatest(1, least(coalesce(p_limit, 8), 20));
  else
    return query select * from v4.find_products(p_bot_id, p_query, p_limit);
  end if;
end $$;

alter table v4.exam_candidates
  add column accepted_at timestamptz,
  add column fixture jsonb;

create or replace function v4.list_exam_candidates(p_bot_id uuid)
returns table (id bigint, question text, answer text, accepted boolean)
language sql stable as $$
  select c.id, c.question, c.answer, c.accepted_at is not null
  from v4.exam_candidates c
  where c.bot_id = p_bot_id
  order by c.id
$$;

create or replace function v4.accept_exam_candidate(p_bot_id uuid, p_id bigint)
returns jsonb language plpgsql as $$
declare fx jsonb;
begin
  update v4.exam_candidates
  set accepted_at = now(),
      fixture = jsonb_build_object('question', question, 'answer', answer, 'mode', 'recorded')
  where bot_id = p_bot_id and id = p_id and accepted_at is null
  returning fixture into fx;
  if fx is not null then
    return jsonb_build_object('already', false, 'fixture', fx);
  end if;
  select fixture into fx from v4.exam_candidates where bot_id = p_bot_id and id = p_id;
  if fx is null then
    raise exception using errcode = 'P0001', message = 'v4:invoice_not_found';
  end if;
  return jsonb_build_object('already', true, 'fixture', fx);
end $$;

alter table v4.inbound_claims enable row level security;
alter table v4.seller_replies enable row level security;
create policy tenant_isolation on v4.inbound_claims for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.seller_replies for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.inbound_claims, v4.seller_replies from public, anon, authenticated, tenant_bot;
grant select, insert on v4.inbound_claims, v4.seller_replies to service_role, tenant_bot;
grant update (accepted_at, fixture) on v4.exam_candidates to service_role, tenant_bot;

revoke all on function
  v4.claim_inbound(uuid, text, text),
  v4.seller_reply(uuid, uuid, text, text),
  v4.last_fulfillment_step(uuid, uuid),
  v4.catalog_search_mode(),
  v4.find_products_wide(uuid, text, integer),
  v4.list_exam_candidates(uuid),
  v4.accept_exam_candidate(uuid, bigint)
  from public, anon, authenticated;
grant execute on function
  v4.claim_inbound(uuid, text, text),
  v4.seller_reply(uuid, uuid, text, text),
  v4.last_fulfillment_step(uuid, uuid),
  v4.catalog_search_mode(),
  v4.find_products_wide(uuid, text, integer),
  v4.list_exam_candidates(uuid),
  v4.accept_exam_candidate(uuid, bigint)
  to service_role, tenant_bot;

-- Проверка (должна вернуть 2 таблицы и 7 функций):
-- select (select count(*) from information_schema.tables where table_schema = 'v4'
--           and table_name in ('inbound_claims', 'seller_replies')) as t,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'v4' and p.proname in
--            ('claim_inbound', 'seller_reply', 'last_fulfillment_step', 'catalog_search_mode',
--             'find_products_wide', 'list_exam_candidates', 'accept_exam_candidate')) as fns;
