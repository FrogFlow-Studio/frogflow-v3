-- Откат v4/027. Только схема v4. Возвращает tick, бронь и отмену к виду до 027.

drop function if exists v4.tick(timestamptz);
create function v4.tick(p_now timestamptz default now())
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

drop function if exists v4.sweep_unanswered(timestamptz);
drop function if exists v4.issue_pay_link(uuid, uuid, timestamptz);
drop table if exists v4.pay_links;
drop function if exists v4.append_lesson(uuid, uuid, text);
drop function if exists v4.release_inbound(uuid, text, text);
drop function if exists v4.order_currency(uuid, uuid);
drop function if exists v4.release_turn(uuid, uuid, uuid, bigint, text);

create function v4.release_turn(
  p_bot_id uuid, p_buyer_id uuid, p_turn_id uuid, p_after_message_id bigint
) returns bigint language plpgsql as $$
declare
  pending bigint;
begin
  perform 1 from v4.buyers where bot_id = p_bot_id and id = p_buyer_id for update;
  select count(*) into pending from v4.messages m
  where m.bot_id = p_bot_id and m.buyer_id = p_buyer_id and m.direction = 'in' and m.id > p_after_message_id;
  if pending = 0 then
    update v4.buyers set turn_id = null, turn_until = null
    where bot_id = p_bot_id and id = p_buyer_id and turn_id = p_turn_id;
  end if;
  return pending;
end $$;

revoke all on function v4.release_turn(uuid, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function v4.release_turn(uuid, uuid, uuid, bigint) to service_role, tenant_bot;

grant execute on function
  v4.ai_settle(uuid, bigint, bigint, integer, timestamptz),
  v4.ai_release(uuid, bigint, timestamptz)
  to tenant_bot;
