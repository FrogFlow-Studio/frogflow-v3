-- Откат v4/018: ИИ-кошелёк.
drop function if exists v4.ai_last_markup_bp();
drop function if exists v4.ai_wallet_drift(uuid);
drop function if exists v4.ai_transfer_to_v3(uuid, text, timestamptz);
drop function if exists v4.ai_transfer_from_v3(uuid, numeric, text, timestamptz);
drop function if exists v4.ai_expire_holds(timestamptz);
drop function if exists v4.ai_release(uuid, bigint, timestamptz);
drop function if exists v4.ai_settle(uuid, bigint, bigint, integer, timestamptz);
drop function if exists v4.ai_close_hold(uuid, bigint, text, bigint, integer, text, timestamptz);
drop function if exists v4.ai_hold(uuid, bigint, text, uuid, bigint, text, timestamptz);
drop function if exists v4.ai_spent_today(uuid, timestamptz);
drop function if exists v4.ai_credit(uuid, text, bigint, text, text, timestamptz);
drop function if exists v4.ai_wallet_lock(uuid);
drop table if exists v4.ai_ledger;
drop table if exists v4.ai_wallet;
delete from v4.case_policies p where p.kind = 'ai_markup'
  and not exists (select 1 from v4.cases c where c.kind = p.kind);
