-- Откат v4/024. record_payment снова берёт комиссию только с трёх шлюзов 002.
create or replace function v4.record_payment(
  p_bot_id uuid, p_order_id uuid, p_amount_minor bigint, p_currency text,
  p_method text, p_external_ref text, p_created_by text, p_note text default null
) returns table (
  entry_id bigint, duplicate boolean, became_paid boolean, order_closed boolean,
  currency_mismatch boolean, paid_minor bigint, due_minor bigint
) language plpgsql as $$
declare
  o v4.orders;
  before_paid bigint;
  after_paid bigint;
  eid bigint;
  fee_bp integer;
  fee bigint;
  s v4.shops;
  rate numeric;
  earn integer;
begin
  select * into o from v4.orders where id = p_order_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  before_paid := v4.order_paid_minor(o.id, o.currency);

  insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, note, created_by)
  values (p_bot_id, o.id, 'payment', p_amount_minor, p_currency, p_method, p_external_ref, p_note, p_created_by)
  on conflict (bot_id, method, external_ref) do nothing
  returning id into eid;

  if eid is null then
    select l.id into eid from v4.ledger l
    where l.bot_id = p_bot_id and l.method = p_method and l.external_ref = p_external_ref;
    after_paid := before_paid;
    return query select eid, true, false, o.status in ('expired', 'cancelled'), p_currency <> o.currency,
      after_paid, greatest(o.total_minor - after_paid, 0);
    return;
  end if;

  after_paid := v4.order_paid_minor(o.id, o.currency);
  insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
  values (p_bot_id, o.id, 'payment', jsonb_build_object('entry_id', eid, 'amount_minor', p_amount_minor,
          'currency', p_currency, 'method', p_method, 'external_ref', p_external_ref), p_created_by);
  if p_currency <> o.currency then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'currency_mismatch', jsonb_build_object('entry_id', eid, 'order_currency', o.currency), p_created_by);
  end if;
  if o.status in ('expired', 'cancelled') then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'payment_on_closed', jsonb_build_object('entry_id', eid, 'status', o.status), p_created_by);
  end if;

  if p_method in ('prodamus', 'apipay', 'robokassa') then
    select max(pm.fee_bp) into fee_bp from v4.payment_methods pm
    where pm.bot_id = p_bot_id and pm.kind = p_method and pm.currency = p_currency;
    fee := round(p_amount_minor * coalesce(fee_bp, 0) / 10000.0)::bigint;
    if fee > 0 then
      insert into v4.ledger (bot_id, order_id, kind, amount_minor, currency, method, external_ref, created_by)
      values (p_bot_id, o.id, 'platform_fee', -fee, p_currency, p_method, 'fee:' || p_external_ref, p_created_by);
    end if;
  end if;

  became_paid := before_paid < o.total_minor and after_paid >= o.total_minor;
  if became_paid then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'paid', jsonb_build_object('paid_minor', after_paid, 'currency', o.currency), p_created_by);
    select * into s from v4.shops where bot_id = p_bot_id;
    rate := v4.rate(p_bot_id, o.currency);
    if not o.is_test and s.points_earn_pct > 0 and rate is not null then
      earn := floor(o.total_minor / 100.0 / rate * s.points_earn_pct / 100)::integer;
      if earn > 0 then
        insert into v4.points (bot_id, buyer_id, order_id, kind, delta, created_by)
        values (p_bot_id, o.buyer_id, o.id, 'earn', earn, p_created_by)
        on conflict do nothing;
      end if;
    end if;
  end if;
  if after_paid > o.total_minor and before_paid <= o.total_minor then
    insert into v4.order_events (bot_id, order_id, kind, detail, created_by)
    values (p_bot_id, o.id, 'overpaid', jsonb_build_object('over_minor', after_paid - o.total_minor), p_created_by);
  end if;

  return query select eid, false, became_paid, o.status in ('expired', 'cancelled'), p_currency <> o.currency,
    after_paid, greatest(o.total_minor - after_paid, 0);
end $$;

drop function if exists v4.shop_preflight(uuid);
drop function if exists v4.sales_days(uuid);
drop function if exists v4.list_products(uuid);
drop function if exists v4.list_orders(uuid, integer);
drop function if exists v4.enqueue_broadcast(uuid, text, text, text);
drop function if exists v4.join_waitlist(uuid, uuid, uuid);
drop function if exists v4.enter_giveaway(uuid, uuid, uuid);
drop function if exists v4.market_products(text);
drop function if exists v4.set_market_listing(uuid, boolean);
drop function if exists v4.vip_active_access(uuid, timestamptz);
drop function if exists v4.note_vip_count(uuid, text, integer, timestamptz);
drop function if exists v4.complete_lesson(uuid, uuid, uuid, timestamptz);
drop function if exists v4.add_lesson(uuid, uuid, text, integer);
drop function if exists v4.advance_fulfillment(uuid, uuid, text, text);
drop function if exists v4.place_order(uuid, uuid, text, uuid[], integer, boolean, text);
drop function if exists v4.stocktake(uuid, uuid, integer, text, text);
drop function if exists v4.move_stock(uuid, uuid, integer, text, text, text);
drop function if exists v4.stock_on_hand(uuid, uuid);
drop function if exists v4.save_product(uuid, text, text, bigint, text, uuid, boolean);
drop function if exists v4.reply_window_open(uuid, text, text, timestamptz);
drop function if exists v4.touch_buyer(uuid, text, text, timestamptz, text, text, text);
drop function if exists v4.record_platform_payment(uuid, uuid, bigint, text, text, text);
drop function if exists v4.is_auto_pay(text);

drop table if exists v4.waitlist;
drop table if exists v4.giveaway_entries;
drop table if exists v4.lesson_progress;
drop table if exists v4.lessons;
drop table if exists v4.fulfillment_steps;
drop table if exists v4.stock_moves;
drop table if exists v4.vip_groups;

delete from v4.case_policies p
 where p.kind in ('fulfillment', 'stock_low', 'giveaway', 'waitlist')
   and not exists (select 1 from v4.cases c where c.kind = p.kind);

alter table v4.payment_methods drop constraint payment_methods_kind_check;
alter table v4.payment_methods add constraint payment_methods_kind_check
  check (kind in ('transfer', 'prodamus', 'apipay', 'robokassa'));
alter table v4.ledger drop constraint ledger_method_check;
alter table v4.ledger add constraint ledger_method_check
  check (method in ('transfer', 'prodamus', 'apipay', 'robokassa', 'manual', 'legacy'));

alter table v4.buyer_channels drop column if exists last_inbound_at;
alter table v4.products drop column if exists track_stock;
alter table v4.shops drop column if exists listed_on_market;
