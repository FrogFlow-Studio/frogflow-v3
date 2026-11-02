-- v4/014: вернуть в очередь уведомление, которое взяли, но не начали отправлять
-- (исполнитель исчерпал бюджет). Только схема v4. Применяет Яков после 013.
-- Условие status = 'sending': отправленное или уже отмеченное не трогаем.
create or replace function v4.release_notification(p_id bigint) returns boolean
language plpgsql as $$
begin
  update v4.notifications set status = 'queued', lease_until = null
  where id = p_id and status = 'sending';
  return found;
end $$;

revoke all on function v4.release_notification(bigint) from public, anon, authenticated, tenant_bot;
grant execute on function v4.release_notification(bigint) to service_role;

-- Проверка (должно вернуть 1):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and p.proname = 'release_notification';
