-- 24-1: номер заказа для покупателя (display_no) больше не повторяется.
--
-- Было: ночной крон nightly_orders_maintenance (05:00 Алматы) удаляет неоплаченные
-- заказы старше 7 дней, затем renumber_orders перенумеровывает order_no в 1..N и
-- ставит счётчик order_counters.last_no = N. display_no заморожен при создании
-- (freeze_display_no), поэтому после отката счётчика новые заказы получали номера,
-- которые уже есть у живых заказов (Копилка: два №126 и два №127; AATeach: дубли
-- №1304–1328). Чек «по заказу №126» нельзя было отнести к одному заказу.
--
-- Стало:
-- 1. assign_order_no выдаёт номер не меньше max(display_no) бота + 1. Строку счётчика
--    бота держит блокировка ON CONFLICT DO UPDATE, поэтому два одновременных заказа
--    одного бота получают разные номера: второй ждёт первого и считает от его last_no.
-- 2. renumber_orders никогда не уменьшает счётчик.
-- 3. Ночной крон только удаляет старые неоплаченные заказы и больше не перенумеровывает
--    (перенумерация каждую ночь переписывала updated_at у всех заказов бота).
-- 4. Разовая подтяжка: счётчик каждого бота = max(last_no, order_no, display_no).
-- 5. Индекс (bot_id, display_no) — чтобы max(display_no) при каждом заказе был дешёвым.
--
-- Таблицы и колонки не меняются (база общая с v1), существующие дубли не трогаются.
-- Файл выполняется целиком одним запросом в SQL-редакторе Supabase.
-- Откат: 24-1-order-numbers-monotonic.down.sql.

CREATE INDEX IF NOT EXISTS idx_orders_bot_display_no ON orders (bot_id, display_no);

CREATE OR REPLACE FUNCTION public.assign_order_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  target_bot uuid := COALESCE(NEW.bot_id, public.current_bot_id());
  max_shown bigint;
BEGIN
  IF NEW.order_no IS NULL AND target_bot IS NOT NULL THEN
    SELECT COALESCE(max(display_no), 0) INTO max_shown
    FROM public.orders WHERE bot_id = target_bot;

    INSERT INTO public.order_counters (bot_id, last_no)
    VALUES (target_bot, max_shown + 1)
    ON CONFLICT (bot_id) DO UPDATE
      SET last_no = GREATEST(public.order_counters.last_no, max_shown) + 1
    RETURNING last_no INTO NEW.order_no;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.renumber_orders(p_bot_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_top bigint;
BEGIN
  -- Фаза 1: временно уводим все номера бота вне диапазона 1..N, чтобы
  -- присвоение в фазе 2 не столкнулось с уникальным индексом (bot_id, order_no).
  UPDATE public.orders
  SET order_no = order_no + 1000000000
  WHERE bot_id = p_bot_id;

  -- Фаза 2: 1..N в хронологическом порядке.
  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM public.orders
    WHERE bot_id = p_bot_id
  )
  UPDATE public.orders o
  SET order_no = ranked.rn
  FROM ranked
  WHERE o.id = ranked.id;

  -- Счётчик только растёт: покупатели держат выданные номера (display_no), и
  -- откат счётчика выдал бы новым заказам уже занятые номера.
  SELECT GREATEST(count(*), COALESCE(max(display_no), 0)) INTO v_top
  FROM public.orders WHERE bot_id = p_bot_id;

  INSERT INTO public.order_counters (bot_id, last_no)
  VALUES (p_bot_id, v_top)
  ON CONFLICT (bot_id) DO UPDATE
    SET last_no = GREATEST(public.order_counters.last_no, EXCLUDED.last_no);
END $function$;

CREATE OR REPLACE FUNCTION public.nightly_orders_maintenance()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.orders
  WHERE status IN ('awaiting_confirmation', 'awaiting_payment')
    AND created_at < now() - interval '7 days'
    AND (fulfillment_kind <> 'physical' OR fulfillment_at IS NULL)
    AND platform <> 'manual'
    AND payment_proof_path IS NULL
    AND COALESCE(paid_amount, 0) = 0;
END $function$;

-- Разовая подтяжка счётчиков, откатившихся прошлыми ночами.
UPDATE public.order_counters oc
SET last_no = m.top
FROM (
  SELECT bot_id, GREATEST(COALESCE(max(order_no), 0), COALESCE(max(display_no), 0)) AS top
  FROM public.orders GROUP BY bot_id
) m
WHERE m.bot_id = oc.bot_id AND m.top > oc.last_no;
