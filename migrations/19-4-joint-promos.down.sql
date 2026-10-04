-- Откат 19-4: удаляет только таблицы совместных акций. Промокоды магазинов (promo_codes) остаются,
-- их продавец удаляет или выключает сам в «Акции и скидки».
drop table if exists public.joint_promo_members;
drop table if exists public.joint_promos;
