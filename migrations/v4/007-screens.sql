-- v4/007: экраны «Сегодня» продавца и «Внимание» оператора (этап 5; решения 13, 14, 43, 66).
-- Только схема v4, только чтение. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- «Сегодня» — только то, что ждёт продавца: открытые дела его вида (поднятые
-- оператору тоже, пока работа за продавцом), и короткая строка «бот сделал сам».
-- «Внимание» — дела оператора и светофор клиентов. Все строки, без обрезки.

-- Дело поднято оператору: шаг сроков «escalate» уже сделан (tick_cases ставит level 2).
create or replace function v4.case_light(p_kind text, p_level smallint, p_created_at timestamptz, p_now timestamptz)
returns text language sql stable as $$
  select case
    when p_kind = 'channel_down' or p_level >= 2 then 'red'
    when p_level = 1 or p_created_at < p_now - interval '24 hours' then 'yellow'
    else 'green' end
$$;

create or replace function v4.today(p_bot_id uuid, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'kind', c.kind, 'level', c.level,
          'light', v4.case_light(c.kind, c.level, c.created_at, p_now),
          'created_at', c.created_at, 'due_at', c.due_at,
          'order_id', c.order_id, 'order_no', o.no, 'buyer_id', c.buyer_id, 'buyer_name', b.name,
          'detail', c.detail)
        order by (c.kind = 'channel_down') desc, c.level desc, c.created_at, c.id)
      from v4.cases c
      join v4.case_policies p on p.kind = c.kind
      left join v4.orders o on o.bot_id = c.bot_id and o.id = c.order_id
      left join v4.buyers b on b.bot_id = c.bot_id and b.id = c.buyer_id
      where c.bot_id = p_bot_id and c.status = 'open' and p.owner = 'seller'), '[]'::jsonb),
    'bot_did', jsonb_build_object(
      'since', p_now - interval '2 days',
      'orders', (select count(*) from v4.orders o
                 where o.bot_id = p_bot_id and not o.is_test and o.created_at >= p_now - interval '2 days'),
      'paid', (select count(*) from v4.order_events e join v4.orders o on o.bot_id = e.bot_id and o.id = e.order_id
               where e.bot_id = p_bot_id and e.kind = 'paid' and not o.is_test
                 and e.created_at >= p_now - interval '2 days'),
      'delivered', (select count(*) from v4.deliveries d
                    where d.bot_id = p_bot_id and d.status = 'sent' and d.created_at >= p_now - interval '2 days'),
      'comments_answered', (select count(*) from v4.comments m
                            where m.bot_id = p_bot_id and m.public_status = 'sent'
                              and m.received_at >= p_now - interval '2 days')),
    'ai_room_micro_usd', v4.ai_room_micro_usd(p_bot_id, p_now))
$$;

-- Оператор (сервисная роль): дела оператора по всем магазинам и светофор магазинов.
create or replace function v4.attention(p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'bot_id', c.bot_id, 'kind', c.kind, 'level', c.level,
          'light', v4.case_light(c.kind, c.level, c.created_at, p_now),
          'created_at', c.created_at, 'order_no', o.no, 'detail', c.detail)
        order by v4.case_light(c.kind, c.level, c.created_at, p_now) = 'red' desc, c.created_at, c.id)
      from v4.cases c
      left join v4.orders o on o.bot_id = c.bot_id and o.id = c.order_id
      where c.status = 'open' and c.owner = 'operator'), '[]'::jsonb),
    'shops', coalesce((
      select jsonb_agg(jsonb_build_object(
          'bot_id', s.bot_id,
          'light', coalesce((
            select case max(case v4.case_light(c.kind, c.level, c.created_at, p_now)
                              when 'red' then 3 when 'yellow' then 2 else 1 end)
                   when 3 then 'red' when 2 then 'yellow' else 'green' end
            from v4.cases c where c.bot_id = s.bot_id and c.status = 'open'), 'green'),
          'open_cases', (select count(*) from v4.cases c where c.bot_id = s.bot_id and c.status = 'open'),
          'orders_2d', (select count(*) from v4.orders o
                        where o.bot_id = s.bot_id and not o.is_test and o.created_at >= p_now - interval '2 days'),
          'ai_room_micro_usd', v4.ai_room_micro_usd(s.bot_id, p_now))
        order by s.bot_id)
      from v4.shops s), '[]'::jsonb))
$$;

revoke all on function v4.case_light(text, smallint, timestamptz, timestamptz), v4.today(uuid, timestamptz),
  v4.attention(timestamptz) from public, anon, authenticated;
grant execute on function v4.case_light(text, smallint, timestamptz, timestamptz), v4.today(uuid, timestamptz)
  to service_role, tenant_bot;
grant execute on function v4.attention(timestamptz) to service_role;

-- Проверка (должно вернуть 3):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'v4' and p.proname in ('case_light', 'today', 'attention');
