-- Откат v4/016: прежние claim_jobs (012) и claim_notifications (003), без buyer_address.

drop function if exists v4.buyer_address(uuid, uuid);

drop function if exists v4.claim_jobs(integer, interval, timestamptz, text[], uuid[]);
create function v4.claim_jobs(
  p_limit integer default 20, p_lease interval default '2 minutes', p_now timestamptz default now(),
  p_kinds text[] default null
) returns setof v4.jobs language plpgsql as $$
begin
  update v4.jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
    last_error = 'аренда истекла', lease_until = null,
    done_at = case when attempts >= max_attempts then p_now end
  where status = 'running' and lease_until < p_now;
  return query
  update v4.jobs j set status = 'running', attempts = j.attempts + 1, lease_until = p_now + p_lease
  where j.id in (
    select id from v4.jobs
    where status = 'queued' and run_at <= p_now and (p_kinds is null or kind = any (p_kinds))
    order by run_at, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;

drop function if exists v4.claim_notifications(text, integer, timestamptz, uuid[]);
create function v4.claim_notifications(
  p_urgency text, p_limit integer default 50, p_now timestamptz default now()
) returns setof v4.notifications language sql as $$
  update v4.notifications n set status = 'sending', lease_until = p_now + interval '2 minutes'
  where n.id in (
    select id from v4.notifications
    where status = 'queued' and urgency = p_urgency
    order by created_at, id
    limit p_limit
    for update skip locked
  )
  returning n.*
$$;

revoke all on function v4.claim_jobs(integer, interval, timestamptz, text[]),
  v4.claim_notifications(text, integer, timestamptz) from public, anon, authenticated, tenant_bot;
grant execute on function v4.claim_jobs(integer, interval, timestamptz, text[]),
  v4.claim_notifications(text, integer, timestamptz) to service_role;
