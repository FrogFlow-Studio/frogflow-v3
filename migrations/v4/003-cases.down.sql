-- Откат v4/003: убирает дела, уведомления, очередь задач и рабочие часы магазина. Только схема v4.
drop view if exists v4.cant_pay_reasons;
drop view if exists v4.buyer_timeline;
drop function if exists v4.tick(timestamptz);
drop function if exists v4.finish_job(bigint, boolean, text, interval);
drop function if exists v4.claim_jobs(integer, interval, timestamptz);
drop function if exists v4.enqueue_job(text, text, uuid, jsonb, timestamptz);
drop function if exists v4.expire_notification_leases(timestamptz);
drop function if exists v4.finish_notification(bigint, text, text);
drop function if exists v4.claim_notifications(text, integer, timestamptz);
drop trigger if exists order_events_cases on v4.order_events;
drop function if exists v4.cases_from_order_event();
drop function if exists v4.hand_to_seller(uuid, uuid, text, text, timestamptz);
drop function if exists v4.tick_cases(timestamptz);
drop function if exists v4.bot_may_reply(uuid, uuid);
drop function if exists v4.close_cases_for(uuid, text, text, text, text);
drop function if exists v4.close_case(uuid, uuid, text, text);
drop function if exists v4.open_case(uuid, text, text, text, uuid, uuid, jsonb, timestamptz);
drop function if exists v4.notify(uuid, text, text, text, text, uuid, uuid, jsonb);
drop table if exists v4.jobs;
drop table if exists v4.notifications;
drop table if exists v4.case_events;
drop table if exists v4.cases;
drop table if exists v4.case_policies;
drop function if exists v4.add_work_hours(uuid, timestamptz, numeric);
alter table v4.shops drop constraint if exists shops_work_hours,
  drop column if exists work_days, drop column if exists work_to, drop column if exists work_from;
