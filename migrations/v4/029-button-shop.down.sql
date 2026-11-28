-- Откат v4/029. Только схема v4.

revoke update (fulfill_on, fulfill_zone, fulfill_address, flower) on v4.orders from tenant_bot;
drop trigger if exists order_events_return_stock on v4.order_events;
drop trigger if exists order_events_refund_access on v4.order_events;
drop function if exists v4.return_stock_on_close();
drop function if exists v4.revoke_access_when_unpaid();
drop function if exists v4.claim_funnel_send(uuid, uuid, text);
drop function if exists v4.list_funnels(uuid);
drop function if exists v4.save_funnel(uuid, text, text, text, jsonb, uuid, integer);
drop function if exists v4.money_lines(uuid, uuid);
drop function if exists v4.remind_physical(uuid, timestamptz);
drop function if exists v4.set_fulfillment(uuid, uuid, date, text, text, jsonb);
drop table if exists v4.funnel_sends;
drop table if exists v4.funnel_steps;
drop table if exists v4.funnels;

alter table v4.orders
  drop column if exists flower,
  drop column if exists fulfill_address,
  drop column if exists fulfill_zone,
  drop column if exists fulfill_on;

create or replace function v4.add_lesson(
  p_bot_id uuid, p_product_id uuid, p_title text, p_position integer
) returns uuid language plpgsql as $$
declare
  lid uuid;
begin
  if not exists (select 1 from v4.products where id = p_product_id and bot_id = p_bot_id and kind = 'club') then
    raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  insert into v4.lessons (bot_id, product_id, title, position)
  values (p_bot_id, p_product_id, p_title, p_position)
  returning id into lid;
  return lid;
end $$;

create or replace function v4.reply_window_open(
  p_bot_id uuid, p_channel text, p_external_id text, p_now timestamptz default now()
) returns boolean language sql stable as $$
  select case
    when p_channel <> 'whatsapp' then true
    else exists (
      select 1 from v4.buyer_channels c
      where c.bot_id = p_bot_id and c.channel = p_channel and c.external_id = p_external_id
        and c.last_inbound_at is not null and c.last_inbound_at > p_now - interval '24 hours')
  end
$$;

create or replace function v4.move_stock(
  p_bot_id uuid, p_product_id uuid, p_delta integer, p_reason text,
  p_external_ref text, p_created_by text
) returns integer language plpgsql as $$
declare
  on_hand integer;
  wrote integer;
begin
  perform 1 from v4.products where id = p_product_id and bot_id = p_bot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'v4:product_not_found'; end if;
  if p_reason not in ('receipt', 'sale', 'writeoff', 'stocktake') or p_delta is null or p_delta = 0 then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  on_hand := v4.stock_on_hand(p_bot_id, p_product_id);
  if on_hand + p_delta < 0 then
    raise exception using errcode = 'P0001', message = 'v4:stock_negative';
  end if;
  insert into v4.stock_moves (bot_id, product_id, delta, reason, external_ref, created_by)
  values (p_bot_id, p_product_id, p_delta, p_reason, p_external_ref, p_created_by)
  on conflict (bot_id, external_ref) do nothing;
  get diagnostics wrote = row_count;
  if wrote = 1 and on_hand + p_delta = 0 then
    perform v4.open_case(p_bot_id, 'stock_low', 'product:' || p_product_id::text, p_created_by, null, null,
      jsonb_build_object('product_id', p_product_id));
  end if;
  return v4.stock_on_hand(p_bot_id, p_product_id);
end $$;

alter table v4.stock_moves drop constraint stock_moves_reason_check;
alter table v4.stock_moves add constraint stock_moves_reason_check
  check (reason in ('receipt', 'sale', 'writeoff', 'stocktake'));
