-- v4/026: способ оплаты, который продавец записывает сам, и список уроков клуба.
-- Только схема v4. Таблицы public не трогает. Комиссию способа продавец не ставит:
-- у перевода она и так 0, у остальных остаётся как была.

create or replace function v4.save_payment_method(
  p_bot_id uuid,
  p_kind text,
  p_country text,
  p_currency text,
  p_details text,
  p_method_id uuid default null
) returns uuid language plpgsql as $$
declare
  mid uuid;
begin
  if not exists (select 1 from v4.shops where bot_id = p_bot_id) then
    raise exception using errcode = 'P0001', message = 'v4:shop_not_found';
  end if;
  if p_kind not in ('transfer', 'prodamus', 'apipay', 'robokassa', 'stripe', 'kaspi', 'nowpayments')
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or not exists (select 1 from v4.country_currency where currency = p_currency) then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_country is not null and (
    p_country !~ '^[A-Z]{2}$'
    or not exists (
      select 1 from v4.country_currency where country = p_country and currency = p_currency
    )
  ) then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_kind = 'transfer' and (
    p_country is null or length(trim(coalesce(p_details, ''))) = 0
  ) then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_method_id is null then
    insert into v4.payment_methods (bot_id, kind, country, currency, details, fee_bp)
    values (p_bot_id, p_kind, p_country, p_currency, coalesce(p_details, ''), 0)
    returning id into mid;
    return mid;
  end if;
  update v4.payment_methods
     set kind = p_kind,
         country = p_country,
         currency = p_currency,
         details = coalesce(p_details, ''),
         fee_bp = case when p_kind = 'transfer' then 0 else fee_bp end
   where id = p_method_id and bot_id = p_bot_id
   returning id into mid;
  if mid is null then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  return mid;
end $$;

create or replace function v4.list_payment_methods(p_bot_id uuid)
returns table (id uuid, kind text, country text, currency text, details text)
language sql stable as $$
  select id, kind, country, currency, details
  from v4.payment_methods
  where bot_id = p_bot_id and active
  order by id
$$;

create or replace function v4.list_lessons(p_bot_id uuid)
returns table (id uuid, product_id uuid, title text, "position" integer)
language sql stable as $$
  select id, product_id, title, "position"
  from v4.lessons
  where bot_id = p_bot_id
  order by product_id, "position", id
$$;

revoke all on function
  v4.save_payment_method(uuid, text, text, text, text, uuid),
  v4.list_payment_methods(uuid),
  v4.list_lessons(uuid)
  from public, anon, authenticated;
grant execute on function
  v4.save_payment_method(uuid, text, text, text, text, uuid),
  v4.list_payment_methods(uuid),
  v4.list_lessons(uuid)
  to service_role, tenant_bot;

-- Проверка (должно вернуть 3 функции):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4'
--    and p.proname in ('save_payment_method', 'list_payment_methods', 'list_lessons');
