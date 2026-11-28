-- Откат v4/028. Только схема v4.

revoke delete on v4.inbound_claims from tenant_bot;
drop function if exists v4.peek_offer(uuid, uuid, text, timestamptz);
