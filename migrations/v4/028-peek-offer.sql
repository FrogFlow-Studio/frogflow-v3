-- v4/028: посмотреть предложение, не создавая заказ.
-- Mini App показывает цену, которую покупатель уже видел, и только потом жмёт «Купить».
-- Снять заявку входящего может роль магазина: иначе сбой оформления оставляет ключ навсегда.

grant delete on v4.inbound_claims to tenant_bot;

create or replace function v4.peek_offer(
  p_bot_id uuid, p_buyer_id uuid, p_offer_id text, p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  f v4.offers;
  ctry text;
  q record;
  ono bigint;
begin
  select * into f from v4.offers where id = upper(p_offer_id) and bot_id = p_bot_id;
  if not found or f.buyer_id <> p_buyer_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if f.order_id is not null then
    select no into ono from v4.orders where id = f.order_id;
    return jsonb_build_object(
      'ok', true, 'state', 'claimed', 'order_id', f.order_id, 'order_no', ono,
      'currency', f.currency, 'total_minor', f.total_minor,
      'product_ids', to_jsonb(f.product_ids), 'prices_minor', to_jsonb(f.prices_minor));
  end if;
  if f.mode = 'shadow' then
    return jsonb_build_object('ok', false, 'reason', 'shadow');
  end if;
  if f.expires_at <= p_now then
    return jsonb_build_object(
      'ok', false, 'reason', 'expired',
      'currency', f.currency, 'total_minor', f.total_minor,
      'product_ids', to_jsonb(f.product_ids), 'prices_minor', to_jsonb(f.prices_minor));
  end if;
  select country into ctry from v4.buyers where bot_id = p_bot_id and id = p_buyer_id;
  select * into q from v4.quote(p_bot_id, f.product_ids, ctry);
  if q.currency <> f.currency or q.total_minor <> f.total_minor
     or exists (select 1 from unnest(f.product_ids) u(id) where v4.product_details(p_bot_id, u.id, null) is null) then
    return jsonb_build_object(
      'ok', false, 'reason', 'price_changed',
      'currency', f.currency, 'total_minor', f.total_minor,
      'product_ids', to_jsonb(f.product_ids), 'prices_minor', to_jsonb(f.prices_minor));
  end if;
  return jsonb_build_object(
    'ok', true, 'state', 'open', 'currency', f.currency, 'total_minor', f.total_minor,
    'product_ids', to_jsonb(f.product_ids), 'prices_minor', to_jsonb(f.prices_minor),
    'expires_at', f.expires_at);
end $$;

revoke all on function v4.peek_offer(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function v4.peek_offer(uuid, uuid, text, timestamptz)
  to service_role, tenant_bot;

-- Проверка (должна вернуть функцию):
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and proname = 'peek_offer';
