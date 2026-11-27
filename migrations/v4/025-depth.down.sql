-- Откат 025. Данные заявок и ответов продавца этой миграции удаляются.

drop function if exists v4.accept_exam_candidate(uuid, bigint);
drop function if exists v4.list_exam_candidates(uuid);
drop function if exists v4.find_products_wide(uuid, text, integer);
drop function if exists v4.catalog_search_mode();
drop function if exists v4.last_fulfillment_step(uuid, uuid);
drop function if exists v4.seller_reply(uuid, uuid, text, text);
drop function if exists v4.claim_inbound(uuid, text, text);

drop table if exists v4.seller_replies;
drop table if exists v4.inbound_claims;

alter table v4.exam_candidates drop column if exists fixture, drop column if exists accepted_at;
