-- Откат v4/004: убирает доступы, выдачу, кабинет, варианты. Только схема v4.
-- Планировщик и постановка задач возвращаются к версии 003.
create or replace function v4.tick(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  expired integer := 0;
  s record;
begin
  for s in select bot_id from v4.shops order by bot_id loop
    expired := expired + v4.expire_orders(s.bot_id, p_now);
  end loop;
  return jsonb_build_object(
    'cases', v4.tick_cases(p_now),
    'orders_expired', expired,
    'notifications_unknown', v4.expire_notification_leases(p_now));
end $$;

create or replace function v4.enqueue_job(
  p_kind text, p_dedupe_key text, p_bot_id uuid default null,
  p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default now()
) returns boolean language plpgsql as $$
declare
  jid bigint;
begin
  insert into v4.jobs (bot_id, kind, dedupe_key, payload, run_at)
  values (p_bot_id, p_kind, p_dedupe_key, p_payload, p_run_at)
  on conflict (kind, dedupe_key) do nothing
  returning id into jid;
  return jid is not null;
end $$;
revoke execute on function v4.enqueue_job(text, text, uuid, jsonb, timestamptz) from tenant_bot;

drop function if exists v4.storage_room(uuid, bigint);
drop view if exists v4.storage_cleanup;
drop view if exists v4.storage_usage;
drop function if exists v4.cabinet_items(uuid, text, timestamptz);
drop function if exists v4.issue_cabinet_link(uuid, uuid, text);
drop table if exists v4.cabinet_links;
drop function if exists v4.delivery_result(uuid, uuid, text, text, text);
drop table if exists v4.deliveries;
drop function if exists v4.expire_access(timestamptz);
drop function if exists v4.revoke_access(uuid, uuid, text, text);
drop trigger if exists order_events_access on v4.order_events;
drop function if exists v4.access_from_order_event();
drop function if exists v4.grant_access_for_order(uuid, uuid, text);
drop function if exists v4.club_root(uuid);
drop table if exists v4.access;
alter table v4.shops drop column if exists storage_limit_bytes;
alter table v4.buyers drop column if exists email;
drop trigger if exists order_items_sellable on v4.order_items;
drop function if exists v4.order_item_sellable();
drop index if exists v4.products_parent_idx;
alter table v4.products drop constraint if exists products_archived, drop constraint if exists products_term_club,
  drop constraint if exists products_variant_label, drop constraint if exists products_parent,
  drop column if exists archived_at, drop column if exists club_chat_id, drop column if exists term,
  drop column if exists file_bytes, drop column if exists storage_path, drop column if exists variant_label,
  drop column if exists parent_id;
