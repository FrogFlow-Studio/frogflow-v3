-- v4/016: крон v4 трогает только магазины, которые обслуживает v4
-- (bots.settings.served_by = "v4"). Задания и уведомления берутся с фильтром
-- по списку магазинов: если магазин скопирован в v4, но ещё не переключён,
-- его выдача и уведомления лежат в очереди и никуда не уходят.
-- И адрес покупателя для уведомлений ему самому (напоминание о продлении клуба).
-- Только схема v4. Применяет Яков после 015.

-- claim_jobs: + p_bot_ids. Старую подпись (012) удаляем, чтобы PostgREST не
-- путался в перегрузках.
drop function if exists v4.claim_jobs(integer, interval, timestamptz, text[]);
create function v4.claim_jobs(
  p_limit integer default 20, p_lease interval default '2 minutes', p_now timestamptz default now(),
  p_kinds text[] default null, p_bot_ids uuid[] default null
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
      and (p_kinds is null or kind = any (p_kinds))
      and (p_bot_ids is null or bot_id = any (p_bot_ids))
    order by run_at, id
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;

-- claim_notifications: + p_bot_ids.
drop function if exists v4.claim_notifications(text, integer, timestamptz);
create function v4.claim_notifications(
  p_urgency text, p_limit integer default 50, p_now timestamptz default now(),
  p_bot_ids uuid[] default null
) returns setof v4.notifications language sql as $$
  update v4.notifications n set status = 'sending', lease_until = p_now + interval '2 minutes'
  where n.id in (
    select id from v4.notifications
    where status = 'queued' and urgency = p_urgency
      and (p_bot_ids is null or bot_id = any (p_bot_ids))
    order by created_at, id
    limit p_limit
    for update skip locked
  )
  returning n.*
$$;

-- Куда писать покупателю: последний его канал (как у выдачи, 015) и язык.
create function v4.buyer_address(p_bot_id uuid, p_buyer_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'channel', bc.channel, 'external_id', bc.external_id,
    'conversation_id', bc.conversation_id, 'account_id', bc.account_id,
    'language', coalesce(b.language, 'ru'))
  from v4.buyers b
  join v4.buyer_channels bc on bc.bot_id = b.bot_id and bc.buyer_id = b.id
  where b.bot_id = p_bot_id and b.id = p_buyer_id
    and bc.channel in ('telegram', 'instagram', 'whatsapp')
  order by bc.created_at desc, bc.channel, bc.external_id
  limit 1
$$;

revoke all on function v4.claim_jobs(integer, interval, timestamptz, text[], uuid[]),
  v4.claim_notifications(text, integer, timestamptz, uuid[]), v4.buyer_address(uuid, uuid)
  from public, anon, authenticated, tenant_bot;
grant execute on function v4.claim_jobs(integer, interval, timestamptz, text[], uuid[]),
  v4.claim_notifications(text, integer, timestamptz, uuid[]), v4.buyer_address(uuid, uuid)
  to service_role;

-- Проверка (должно вернуть 3):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and p.proname in ('claim_jobs', 'claim_notifications', 'buyer_address')
--    and (p.proname = 'buyer_address' or 'p_bot_ids' = any (p.proargnames));
