-- Откат v4/023: польза, учёба, право, сигналы. learn_from_reply — как в 021.
drop function if exists v4.ai_signals(uuid, timestamptz);
drop function if exists v4.forget_buyer(uuid, uuid, text, timestamptz);
drop function if exists v4.ai_value_report(uuid, timestamptz, timestamptz);
delete from v4.case_policies p where p.kind = 'ai_health'
  and not exists (select 1 from v4.cases c where c.kind = p.kind);
alter table v4.buyers drop column if exists forgotten_at;

create or replace function v4.learn_from_reply(
  p_bot_id uuid, p_case_id uuid, p_question text, p_answer text,
  p_product_id uuid default null, p_created_by text default 'seller'
) returns uuid language plpgsql as $$
declare
  kid uuid;
begin
  insert into v4.knowledge (bot_id, product_id, question, answer, source, case_id, created_by, needs_review)
  values (p_bot_id, p_product_id, p_question, p_answer, 'seller_reply', p_case_id, p_created_by,
          v4.knowledge_risky(p_answer))
  on conflict (case_id) where case_id is not null do nothing
  returning id into kid;
  perform v4.close_case(p_bot_id, p_case_id, 'Продавец ответил, ответ сохранён в знания', p_created_by);
  if kid is null then
    select id into kid from v4.knowledge where case_id = p_case_id;
  end if;
  return kid;
end $$;

drop table if exists v4.exam_candidates;
