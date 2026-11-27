-- Откат v4/021: роль «продавец». Возвращает функции 005 (лимит месяца) и знания без проверки.
drop function if exists v4.seller_readiness(uuid);
drop function if exists v4.ai_auto_cap(uuid, timestamptz);
drop function if exists v4.offer_products(uuid, uuid, text);
drop function if exists v4.seller_context_v2(uuid, uuid, text, timestamptz);
drop function if exists v4.review_knowledge(uuid, uuid, boolean);
drop function if exists v4.save_ai_features(uuid, jsonb, integer);

create or replace function v4.ai_room_micro_usd(p_bot_id uuid, p_now timestamptz default now())
returns bigint language sql stable as $$
  select s.ai_monthly_limit_micro_usd - coalesce((
    select sum(u.cost_micro_usd) from v4.ai_usage u
    where u.bot_id = s.bot_id
      and u.created_at >= (date_trunc('month', p_now at time zone s.timezone) at time zone s.timezone)
  ), 0)::bigint
  from v4.shops s where s.bot_id = p_bot_id
$$;

create or replace function v4.record_ai_usage(
  p_bot_id uuid, p_purpose text, p_model text, p_input integer, p_output integer,
  p_cost_micro_usd bigint, p_buyer_id uuid default null, p_now timestamptz default now()
) returns bigint language plpgsql as $$
declare
  room bigint;
  s v4.shops;
begin
  insert into v4.ai_usage (bot_id, purpose, model, input_tokens, output_tokens, cost_micro_usd, buyer_id, created_at)
  values (p_bot_id, p_purpose, p_model, p_input, p_output, p_cost_micro_usd, p_buyer_id, p_now);
  room := v4.ai_room_micro_usd(p_bot_id, p_now);
  if room <= 0 then
    select * into s from v4.shops where bot_id = p_bot_id;
    perform v4.open_case(p_bot_id, 'ai_limit', 'month:' || to_char(p_now at time zone s.timezone, 'YYYY-MM'),
                         'ai', null, null, jsonb_build_object('limit_micro_usd', s.ai_monthly_limit_micro_usd), p_now);
  end if;
  return room;
end $$;

create or replace function v4.learn_from_reply(
  p_bot_id uuid, p_case_id uuid, p_question text, p_answer text,
  p_product_id uuid default null, p_created_by text default 'seller'
) returns uuid language plpgsql as $$
declare
  kid uuid;
begin
  insert into v4.knowledge (bot_id, product_id, question, answer, source, case_id, created_by)
  values (p_bot_id, p_product_id, p_question, p_answer, 'seller_reply', p_case_id, p_created_by)
  on conflict (case_id) where case_id is not null do nothing
  returning id into kid;
  perform v4.close_case(p_bot_id, p_case_id, 'Продавец ответил, ответ сохранён в знания', p_created_by);
  if kid is null then
    select id into kid from v4.knowledge where case_id = p_case_id;
  end if;
  return kid;
end $$;

drop function if exists v4.knowledge_risky(text);
alter table v4.knowledge drop column if exists needs_review;
alter table v4.shops drop constraint if exists shops_ai_features_valid;
drop function if exists v4.ai_features_valid(jsonb);
alter table v4.shops drop column if exists ai_features_rev, drop column if exists ai_features,
  drop column if exists default_lang;
