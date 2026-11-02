-- Откат v4/005: убирает расход ИИ, знания и поиск товара. Только схема v4.
revoke select, insert on v4.cabinet_links from tenant_bot;
drop policy if exists tenant_isolation on v4.cabinet_links;
revoke execute on function v4.issue_cabinet_link(uuid, uuid, text) from tenant_bot;
drop function if exists v4.buyer_open_orders(uuid, uuid);
drop function if exists v4.seller_context(uuid, uuid, timestamptz);
drop function if exists v4.product_card(uuid, uuid);
drop function if exists v4.quote(uuid, uuid[], text);
drop function if exists v4.find_products(uuid, text, integer);
drop function if exists v4.learn_from_reply(uuid, uuid, text, text, uuid, text);
drop table if exists v4.knowledge;
drop function if exists v4.record_ai_usage(uuid, text, text, integer, integer, bigint, uuid, timestamptz);
drop function if exists v4.ai_room_micro_usd(uuid, timestamptz);
drop table if exists v4.ai_usage;
alter table v4.shops drop column if exists spam_words, drop column if exists seller_profile,
  drop column if exists ai_monthly_limit_micro_usd;
