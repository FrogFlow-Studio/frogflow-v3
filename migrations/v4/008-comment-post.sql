-- v4/008: отправщику комментариев нужен пост (Zernio отвечает по посту и комментарию).
-- Только схема v4. Применяет Яков в SQL-редакторе Supabase после 007.

drop function if exists v4.claim_comment_sends(integer, timestamptz);
create or replace function v4.claim_comment_sends(p_limit integer default 20, p_now timestamptz default now())
returns table (comment_id uuid, bot_id uuid, channel text, kind text, external_id text, post_id text,
               commenter_external_id text, text text)
language plpgsql as $$
#variable_conflict use_column
begin
  update v4.comments set public_status = 'unknown'
  where public_status = 'sending' and public_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set dm_status = 'unknown'
  where dm_status = 'sending' and dm_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set card_status = 'unknown'
  where card_status = 'sending' and card_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set dm_status = 'expired'
  where dm_status = 'pending' and commented_at < p_now - interval '6 days 12 hours';

  return query
  with pub as (
    select c.id from v4.comments c where c.public_status = 'pending'
    order by c.received_at, c.id limit greatest(1, p_limit) for update skip locked
  ), pu as (
    update v4.comments c set public_status = 'sending', public_lease_at = p_now
    from pub where c.id = pub.id
    returning c.id, c.bot_id, c.channel, 'public'::text as kind, c.external_id, c.post_id, c.commenter_external_id, c.rule_id
  )
  select pu.id, pu.bot_id, pu.channel, pu.kind, pu.external_id, pu.post_id, pu.commenter_external_id, cr.public_reply
  from pu join v4.comment_rules cr on cr.id = pu.rule_id;

  return query
  with dm as (
    select c.id from v4.comments c where c.dm_status = 'pending' and c.dm_not_before <= p_now
    order by c.dm_not_before, c.id limit greatest(1, p_limit) for update skip locked
  ), du as (
    update v4.comments c set dm_status = 'sending', dm_lease_at = p_now
    from dm where c.id = dm.id
    returning c.id, c.bot_id, c.channel, 'dm'::text as kind, c.external_id, c.post_id, c.commenter_external_id, c.rule_id
  )
  select du.id, du.bot_id, du.channel, du.kind, du.external_id, du.post_id, du.commenter_external_id, cr.dm_first
  from du join v4.comment_rules cr on cr.id = du.rule_id;
end $$;
revoke all on function v4.claim_comment_sends(integer, timestamptz) from public, anon, authenticated, tenant_bot;
grant execute on function v4.claim_comment_sends(integer, timestamptz) to service_role;

-- Проверка (должно вернуть post_id):
-- select unnest(proargnames) from pg_proc where proname = 'claim_comment_sends' and 'post_id' = any(proargnames)
--   intersect select 'post_id';
