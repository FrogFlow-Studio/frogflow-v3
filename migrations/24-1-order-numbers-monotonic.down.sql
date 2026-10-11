-- Откат 24-1: прежние версии функций (как в базе до 11.10.2026). Подтянутые счётчики
-- не возвращаются назад: следующая ночная перенумерация сама поставит last_no = N.
DROP INDEX IF EXISTS idx_orders_bot_display_no;

CREATE OR REPLACE FUNCTION public.assign_order_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE target_bot uuid := COALESCE(NEW.bot_id, public.current_bot_id());
BEGIN
  IF NEW.order_no IS NULL AND target_bot IS NOT NULL THEN
    INSERT INTO public.order_counters (bot_id, last_no)
    VALUES (target_bot, 1)
    ON CONFLICT (bot_id) DO UPDATE
      SET last_no = public.order_counters.last_no + 1
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
  v_count bigint;
BEGIN
  UPDATE public.orders
  SET order_no = order_no + 1000000000
  WHERE bot_id = p_bot_id;

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM public.orders
    WHERE bot_id = p_bot_id
  )
  UPDATE public.orders o
  SET order_no = ranked.rn
  FROM ranked
  WHERE o.id = ranked.id;

  SELECT count(*) INTO v_count FROM public.orders WHERE bot_id = p_bot_id;

  INSERT INTO public.order_counters (bot_id, last_no)
  VALUES (p_bot_id, v_count)
  ON CONFLICT (bot_id) DO UPDATE SET last_no = EXCLUDED.last_no;
END $function$;

CREATE OR REPLACE FUNCTION public.nightly_orders_maintenance()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  b record;
BEGIN
  DELETE FROM public.orders
  WHERE status IN ('awaiting_confirmation', 'awaiting_payment')
    AND created_at < now() - interval '7 days'
    AND (fulfillment_kind <> 'physical' OR fulfillment_at IS NULL)
    AND platform <> 'manual'
    AND payment_proof_path IS NULL
    AND COALESCE(paid_amount, 0) = 0;

  FOR b IN
    SELECT bt.id
    FROM public.bots bt
    LEFT JOIN public.order_counters oc ON oc.bot_id = bt.id
    WHERE oc.bot_id IS NULL
       OR oc.last_no IS DISTINCT FROM (
         SELECT count(*) FROM public.orders o WHERE o.bot_id = bt.id
       )
  LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $function$;
