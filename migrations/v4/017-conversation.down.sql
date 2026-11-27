-- Откат v4/017: журнал сообщений, память о покупателе, ход, предел ответов, блок.
drop function if exists v4.agent_buyer_state(uuid, uuid);
drop function if exists v4.ai_log_usage(uuid, text, text, integer, integer, bigint, uuid, timestamptz);
drop function if exists v4.record_incoming(uuid, uuid, text, text, text, text, text, timestamptz);
drop function if exists v4.take_turn(uuid, uuid, uuid, integer, timestamptz);
drop function if exists v4.release_turn(uuid, uuid, uuid, bigint);
drop function if exists v4.count_ai_reply(uuid, uuid, integer, timestamptz);
drop function if exists v4.record_reply(uuid, uuid, text, text, jsonb, jsonb, text, text, text, bigint, text, text, text, timestamptz);
drop function if exists v4.conversation_history(uuid, uuid, text, integer);
drop function if exists v4.remember_fact(uuid, uuid, text, text, text, timestamptz);
drop function if exists v4.block_buyer(uuid, uuid, text, timestamptz);
drop function if exists v4.unblock_buyer(uuid, uuid);
drop table if exists v4.buyer_facts;
drop table if exists v4.messages;
alter table v4.buyers
  drop column if exists blocked_at,
  drop column if exists blocked_by,
  drop column if exists turn_id,
  drop column if exists turn_until,
  drop column if exists ai_replies_day,
  drop column if exists ai_replies_date;
