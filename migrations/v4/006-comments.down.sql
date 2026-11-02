-- Откат v4/006: убирает комментарии и Direct. Только схема v4.
drop function if exists v4.finish_card(uuid, uuid, text);
drop function if exists v4.claim_card(uuid, uuid, timestamptz);
drop function if exists v4.finish_comment_send(uuid, text, text, timestamptz);
drop function if exists v4.claim_comment_sends(integer, timestamptz);
drop function if exists v4.note_external_dm(uuid, text, text);
drop function if exists v4.accept_comment(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz);
drop function if exists v4.comment_lease_interval();
drop table if exists v4.comments;
drop table if exists v4.comment_rules;
drop function if exists v4.is_spam(uuid, text);
