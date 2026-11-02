-- Откат v4/012: убирает выдачу задачей и возвращает claim_jobs без отбора по видам.
drop function if exists v4.claim_jobs(integer, interval, timestamptz, text[]);
drop function if exists v4.claim_delivery(uuid, uuid, text);
drop function if exists v4.delivery_plan(uuid, uuid);
drop table if exists v4.delivery_claims;
create or replace function v4.claim_jobs(
  p_limit integer default 20, p_lease interval default '2 minutes', p_now timestamptz default now()
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
    where status = 'queued' and run_at <= p_now
    order by run_at, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;
revoke all on function v4.claim_jobs(integer, interval, timestamptz) from public, anon, authenticated, tenant_bot;
grant execute on function v4.claim_jobs(integer, interval, timestamptz) to service_role;
