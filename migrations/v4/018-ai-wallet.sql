-- v4/018: ИИ-кошелёк магазина (этап 1 «Мозг магазина», шаг 4; решение 98 в правке 27.11).
-- Только схема v4. Таблицы public не трогает. Применяет Яков после 017.
--
-- Главное:
--  * Вместо месячного лимита в тарифе — баланс в микродолларах, как ИИ-баланс v3,
--    с наценкой оператора (25 % на 27.11). Процент пишется в каждую запись: видно,
--    по какой наценке списан каждый ответ.
--  * Книга ИИ только дописывается. Остаток в строке кошелька меняют функции
--    ai_hold / ai_settle / ai_release под блокировкой строки (for update).
--  * Перед вызовом модели — бронь (hold). После — расчёт по факту (settle) или
--    возврат (release). Бронь закрывается ровно один раз; висящая дольше
--    5 минут закрывается тиком (expire) с возвратом.
--  * Дневной предел расхода магазина (В5) проверяет та же бронь.
--  * Перенос остатка из v3 — одна запись на магазин (уникальный ключ), стартовые
--    5 долл. при переносе не начисляются. Возврат в v3 при откате — запись
--    transfer_to_v3, остаток в ноль.

create table v4.ai_wallet (
  bot_id uuid primary key references v4.shops (bot_id),
  balance_micro_usd bigint not null default 0,
  low_at timestamptz,
  empty_at timestamptz,
  updated_at timestamptz not null default now()
);

create table v4.ai_ledger (
  id bigint generated always as identity primary key,
  bot_id uuid not null references v4.shops (bot_id),
  kind text not null check (kind in ('start', 'topup', 'transfer_from_v3', 'hold', 'settle', 'release',
                                     'expire', 'adjust', 'transfer_to_v3')),
  -- Изменение остатка этой записью (бронь — минус, возврат — плюс).
  amount_micro_usd bigint not null,
  -- Для settle: цена API, наценка в базисных пунктах (2500 = 25 %), итог с наценкой.
  api_micro_usd bigint check (api_micro_usd >= 0),
  markup_bp integer check (markup_bp between 0 and 100000),
  total_micro_usd bigint check (total_micro_usd >= 0),
  hold_id bigint references v4.ai_ledger (id),
  expires_at timestamptz,
  purpose text,
  buyer_id uuid,
  mode text check (mode in ('live', 'test')),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  check ((kind = 'hold') = (expires_at is not null)),
  check (kind not in ('settle', 'release', 'expire') or hold_id is not null),
  check (kind <> 'settle' or (api_micro_usd is not null and markup_bp is not null and total_micro_usd is not null))
);
create index ai_ledger_bot on v4.ai_ledger (bot_id, created_at, id);
-- Бронь закрывается один раз: settle, release или expire.
create unique index ai_ledger_hold_closed_once on v4.ai_ledger (hold_id) where hold_id is not null;
-- Перенос из v3 — один на магазин.
create unique index ai_ledger_transfer_once on v4.ai_ledger (bot_id) where kind = 'transfer_from_v3';
create index ai_ledger_open_holds on v4.ai_ledger (expires_at) where kind = 'hold';

-- Наценка не читается — дело оператору (12.4 проекта).
insert into v4.case_policies values
  ('ai_markup', 'operator', '24 hours', 'remind', null, null, false, 'digest');

-- Строка кошелька под блокировкой; нет — создаётся с нулём.
-- Функции кошелька — security definer: арендатор не пишет в кошелёк и книгу
-- напрямую (иначе мог бы поднять себе остаток), только через бронь и расчёт,
-- и только за свой магазин (bot_id из JWT).
create or replace function v4.ai_wallet_lock(p_bot_id uuid) returns v4.ai_wallet
language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  w v4.ai_wallet;
begin
  if v4.current_bot_id() is not null and v4.current_bot_id() <> p_bot_id then
    raise exception using errcode = 'P0001', message = 'v4:foreign_bot';
  end if;
  insert into v4.ai_wallet (bot_id) values (p_bot_id) on conflict (bot_id) do nothing;
  select * into w from v4.ai_wallet where bot_id = p_bot_id for update;
  return w;
end $$;

-- Пополнение, стартовые, ручная правка — только сервисная роль (оператор).
create or replace function v4.ai_credit(
  p_bot_id uuid, p_kind text, p_amount_micro_usd bigint, p_note text, p_created_by text,
  p_now timestamptz default now()
) returns bigint language plpgsql as $$
declare
  w v4.ai_wallet;
begin
  if p_kind not in ('start', 'topup', 'adjust') then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  if p_kind <> 'adjust' and p_amount_micro_usd <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  if p_kind = 'adjust' and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = 'P0001', message = 'v4:reason_required';
  end if;
  w := v4.ai_wallet_lock(p_bot_id);
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, note, created_by, created_at)
  values (p_bot_id, p_kind, p_amount_micro_usd, p_note, p_created_by, p_now);
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd + p_amount_micro_usd,
    empty_at = case when balance_micro_usd + p_amount_micro_usd > 0 then null else empty_at end,
    low_at = case when balance_micro_usd + p_amount_micro_usd > 1000000 then null else low_at end,
    updated_at = p_now
  where bot_id = p_bot_id;
  return w.balance_micro_usd + p_amount_micro_usd;
end $$;

-- Потрачено с наценкой сегодня по часам магазина (для дневного предела).
create or replace function v4.ai_spent_today(p_bot_id uuid, p_now timestamptz default now())
returns bigint language sql stable as $$
  select coalesce(sum(l.total_micro_usd), 0)::bigint
  from v4.ai_ledger l, v4.shops s
  where s.bot_id = p_bot_id and l.bot_id = p_bot_id and l.kind = 'settle'
    and (l.created_at at time zone s.timezone)::date = (p_now at time zone s.timezone)::date
$$;

-- Бронь перед вызовом модели. Итог: {ok, hold_id} или {ok:false, reason}:
-- wallet_empty — остатка не хватает на бронь; limit_day — дневной предел магазина.
-- Отказ по пустому кошельку или дневному пределу открывает продавцу дело, одно в сутки на причину.
create or replace function v4.ai_hold(
  p_bot_id uuid, p_amount_micro_usd bigint, p_purpose text, p_buyer_id uuid default null,
  p_daily_cap_micro_usd bigint default null, p_mode text default 'live', p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  w v4.ai_wallet;
  hid bigint;
  tz text;
begin
  if p_amount_micro_usd <= 0 then
    raise exception using errcode = 'P0001', message = 'v4:amount_not_positive';
  end if;
  w := v4.ai_wallet_lock(p_bot_id);
  select timezone into tz from v4.shops where bot_id = p_bot_id;
  if p_daily_cap_micro_usd is not null and v4.ai_spent_today(p_bot_id, p_now) >= p_daily_cap_micro_usd then
    -- Дневной предел: продавцу одно дело в сутки («ИИ сегодня потратил больше обычного»).
    perform v4.open_case(p_bot_id, 'ai_limit', 'day:' || to_char(p_now at time zone tz, 'YYYY-MM-DD'),
                         'ai', null, null, jsonb_build_object('cap_micro_usd', p_daily_cap_micro_usd), p_now);
    return jsonb_build_object('ok', false, 'reason', 'limit_day');
  end if;
  if w.balance_micro_usd < p_amount_micro_usd then
    if w.empty_at is null then
      update v4.ai_wallet set empty_at = p_now, updated_at = p_now where bot_id = p_bot_id;
    end if;
    perform v4.open_case(p_bot_id, 'ai_limit', 'empty:' || to_char(p_now at time zone tz, 'YYYY-MM-DD'),
                         'ai', null, null, jsonb_build_object('balance_micro_usd', w.balance_micro_usd), p_now);
    return jsonb_build_object('ok', false, 'reason', 'wallet_empty');
  end if;
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, expires_at, purpose, buyer_id, mode, created_by, created_at)
  values (p_bot_id, 'hold', -p_amount_micro_usd, p_now + interval '5 minutes', p_purpose, p_buyer_id, p_mode, 'ai', p_now)
  returning id into hid;
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd - p_amount_micro_usd, updated_at = p_now
  where bot_id = p_bot_id;
  return jsonb_build_object('ok', true, 'hold_id', hid);
end $$;

-- Закрыть бронь: вернуть её сумму и списать фактическое (с наценкой). Одна
-- запись на бронь; повтор — отказ append_only (уже закрыта), остаток не меняется.
create or replace function v4.ai_close_hold(
  p_bot_id uuid, p_hold_id bigint, p_kind text, p_api_micro_usd bigint, p_markup_bp integer,
  p_created_by text, p_now timestamptz
) returns bigint language plpgsql security definer set search_path = v4, pg_temp as $$
declare
  h v4.ai_ledger;
  total bigint := 0;
  delta bigint;
  w v4.ai_wallet;
begin
  w := v4.ai_wallet_lock(p_bot_id);
  select * into h from v4.ai_ledger where id = p_hold_id and bot_id = p_bot_id and kind = 'hold';
  if not found then raise exception using errcode = 'P0001', message = 'v4:order_not_found'; end if;
  if exists (select 1 from v4.ai_ledger where hold_id = p_hold_id) then
    raise exception using errcode = 'P0001', message = 'v4:append_only';
  end if;
  if p_kind = 'settle' then
    -- Наценка округляется вверх до микродоллара: платформа не теряет дробные доли.
    total := (greatest(p_api_micro_usd, 0) * (10000 + p_markup_bp) + 9999) / 10000;
  end if;
  delta := -h.amount_micro_usd - total;
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, api_micro_usd, markup_bp, total_micro_usd,
                            hold_id, purpose, buyer_id, mode, created_by, created_at)
  values (p_bot_id, p_kind, delta,
          case when p_kind = 'settle' then greatest(p_api_micro_usd, 0) end,
          case when p_kind = 'settle' then p_markup_bp end,
          case when p_kind = 'settle' then total end,
          p_hold_id, h.purpose, h.buyer_id, h.mode, p_created_by, p_now);
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd + delta,
    low_at = case when balance_micro_usd + delta <= 1000000 and low_at is null then p_now else low_at end,
    empty_at = case when balance_micro_usd + delta <= 0 and empty_at is null then p_now else empty_at end,
    updated_at = p_now
  where bot_id = p_bot_id;
  return total;
end $$;

create or replace function v4.ai_settle(
  p_bot_id uuid, p_hold_id bigint, p_api_micro_usd bigint, p_markup_bp integer, p_now timestamptz default now()
) returns bigint language sql security definer set search_path = v4, pg_temp as $$
  select v4.ai_close_hold(p_bot_id, p_hold_id, 'settle', p_api_micro_usd, p_markup_bp, 'ai', p_now)
$$;

create or replace function v4.ai_release(p_bot_id uuid, p_hold_id bigint, p_now timestamptz default now())
returns bigint language sql security definer set search_path = v4, pg_temp as $$
  select v4.ai_close_hold(p_bot_id, p_hold_id, 'release', 0, 0, 'ai', p_now)
$$;

-- Тик: брони старше 5 минут без закрытия возвращаются (функция упала до расчёта).
create or replace function v4.ai_expire_holds(p_now timestamptz default now())
returns integer language plpgsql as $$
declare
  h record;
  n integer := 0;
begin
  for h in
    select l.bot_id, l.id from v4.ai_ledger l
    where l.kind = 'hold' and l.expires_at <= p_now
      and not exists (select 1 from v4.ai_ledger c where c.hold_id = l.id)
    order by l.id
  loop
    begin
      perform v4.ai_close_hold(h.bot_id, h.id, 'expire', 0, 0, 'tick', p_now);
      n := n + 1;
    exception when unique_violation then null;  -- закрыли параллельно
    end;
  end loop;
  return n;
end $$;

-- Перенос остатка из v3 (app_settings.ai_balance.usd) после переключения магазина
-- на v4. Округление вниз до микродоллара. Повтор — тот же итог без второй записи.
create or replace function v4.ai_transfer_from_v3(
  p_bot_id uuid, p_usd numeric, p_created_by text, p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  micro bigint := floor(greatest(coalesce(p_usd, 0), 0) * 1000000)::bigint;
  lid bigint;
begin
  perform v4.ai_wallet_lock(p_bot_id);
  insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, note, created_by, created_at)
  values (p_bot_id, 'transfer_from_v3', micro, 'Остаток ИИ-баланса v3: ' || p_usd::text || ' долл.', p_created_by, p_now)
  on conflict (bot_id) where kind = 'transfer_from_v3' do nothing
  returning id into lid;
  if lid is null then
    return jsonb_build_object('transferred', false,
      'micro_usd', (select amount_micro_usd from v4.ai_ledger where bot_id = p_bot_id and kind = 'transfer_from_v3'));
  end if;
  update v4.ai_wallet set balance_micro_usd = balance_micro_usd + micro,
    empty_at = case when balance_micro_usd + micro > 0 then null else empty_at end, updated_at = p_now
  where bot_id = p_bot_id;
  return jsonb_build_object('transferred', true, 'micro_usd', micro);
end $$;

-- Возврат в v3 при откате: остаток (не меньше нуля) записью transfer_to_v3, кошелёк в ноль.
-- Открытые брони сначала закрываются возвратом. Возвращает микродоллары для v3.
create or replace function v4.ai_transfer_to_v3(p_bot_id uuid, p_created_by text, p_now timestamptz default now())
returns bigint language plpgsql as $$
declare
  w v4.ai_wallet;
  h record;
  amount bigint;
begin
  w := v4.ai_wallet_lock(p_bot_id);
  for h in
    select l.id from v4.ai_ledger l
    where l.bot_id = p_bot_id and l.kind = 'hold' and not exists (select 1 from v4.ai_ledger c where c.hold_id = l.id)
  loop
    perform v4.ai_close_hold(p_bot_id, h.id, 'release', 0, 0, p_created_by, p_now);
  end loop;
  select * into w from v4.ai_wallet where bot_id = p_bot_id;
  amount := greatest(w.balance_micro_usd, 0);
  if amount > 0 then
    insert into v4.ai_ledger (bot_id, kind, amount_micro_usd, note, created_by, created_at)
    values (p_bot_id, 'transfer_to_v3', -amount, 'Возврат остатка в v3 при откате', p_created_by, p_now);
    update v4.ai_wallet set balance_micro_usd = balance_micro_usd - amount, updated_at = p_now where bot_id = p_bot_id;
  end if;
  return amount;
end $$;

-- Сверка: остаток кошелька = сумма книги (запрос оператора и тест).
create or replace function v4.ai_wallet_drift(p_bot_id uuid) returns bigint language sql stable as $$
  select coalesce((select balance_micro_usd from v4.ai_wallet where bot_id = p_bot_id), 0)
       - coalesce((select sum(amount_micro_usd) from v4.ai_ledger where bot_id = p_bot_id), 0)
$$;

-- Последняя наценка, по которой списан ответ (любой магазин): запасное значение,
-- когда настройка оператора не читается (12.4 проекта). Только число, без строк.
create or replace function v4.ai_last_markup_bp() returns integer
language sql stable security definer set search_path = v4, pg_temp as $$
  select l.markup_bp from v4.ai_ledger l where l.kind = 'settle' order by l.id desc limit 1
$$;

-- ── права ──────────────────────────────────────────────────────────────────
alter table v4.ai_wallet enable row level security;
alter table v4.ai_ledger enable row level security;
create policy own_wallet_read on v4.ai_wallet for select to tenant_bot using (bot_id = v4.current_bot_id());
create policy own_ledger_read on v4.ai_ledger for select to tenant_bot using (bot_id = v4.current_bot_id());

revoke all on v4.ai_wallet, v4.ai_ledger from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.ai_wallet, v4.ai_ledger to service_role;
-- Арендатор только читает; пишут функции брони и расчёта (security definer).
grant select on v4.ai_wallet, v4.ai_ledger to tenant_bot;

revoke all on function v4.ai_wallet_lock(uuid), v4.ai_credit(uuid, text, bigint, text, text, timestamptz),
  v4.ai_spent_today(uuid, timestamptz), v4.ai_hold(uuid, bigint, text, uuid, bigint, text, timestamptz),
  v4.ai_close_hold(uuid, bigint, text, bigint, integer, text, timestamptz),
  v4.ai_settle(uuid, bigint, bigint, integer, timestamptz), v4.ai_release(uuid, bigint, timestamptz),
  v4.ai_expire_holds(timestamptz), v4.ai_transfer_from_v3(uuid, numeric, text, timestamptz),
  v4.ai_transfer_to_v3(uuid, text, timestamptz),
  v4.ai_wallet_drift(uuid), v4.ai_last_markup_bp()
  from public, anon, authenticated, tenant_bot;
grant execute on function v4.ai_wallet_lock(uuid), v4.ai_credit(uuid, text, bigint, text, text, timestamptz),
  v4.ai_spent_today(uuid, timestamptz), v4.ai_hold(uuid, bigint, text, uuid, bigint, text, timestamptz),
  v4.ai_close_hold(uuid, bigint, text, bigint, integer, text, timestamptz),
  v4.ai_settle(uuid, bigint, bigint, integer, timestamptz), v4.ai_release(uuid, bigint, timestamptz),
  v4.ai_expire_holds(timestamptz), v4.ai_transfer_from_v3(uuid, numeric, text, timestamptz),
  v4.ai_transfer_to_v3(uuid, text, timestamptz),
  v4.ai_wallet_drift(uuid), v4.ai_last_markup_bp()
  to service_role;
grant execute on function v4.ai_spent_today(uuid, timestamptz),
  v4.ai_hold(uuid, bigint, text, uuid, bigint, text, timestamptz),
  v4.ai_settle(uuid, bigint, bigint, integer, timestamptz), v4.ai_release(uuid, bigint, timestamptz),
  v4.ai_wallet_drift(uuid), v4.ai_last_markup_bp()
  to tenant_bot;

-- Проверка (должно вернуть 2 таблицы и политику ai_markup):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename in ('ai_wallet', 'ai_ledger')) as tables,
--        (select count(*) from v4.case_policies where kind = 'ai_markup') as policy;
