-- Откат v4/020: предложения бота.
drop function if exists v4.attach_offers(uuid, text[], bigint);
drop function if exists v4.claim_offer(uuid, uuid, text, timestamptz);
drop function if exists v4.create_offer(uuid, uuid, uuid[], text, timestamptz);
drop function if exists v4.offer_code();
drop table if exists v4.offers;
