-- v4/010: панель продавца v4 — есть ли магазин в v4. Только схема v4.
-- Применяет Яков в SQL-редакторе Supabase после 009. Ничего не переключает:
-- страница «Сегодня (v4)» показывает данные только магазину, который уже есть в v4.

-- security invoker: под ролью арендатора RLS на v4.shops показывает только свой магазин,
-- поэтому про чужой bot_id функция всегда отвечает false.
create or replace function v4.shop_ready(p_bot_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from v4.shops s where s.bot_id = p_bot_id)
$$;

revoke all on function v4.shop_ready(uuid) from public, anon, authenticated;
grant execute on function v4.shop_ready(uuid) to service_role, tenant_bot;

-- Проверка (должно вернуть false — магазинов в v4 пока нет):
-- select v4.shop_ready('00000000-0000-0000-0000-000000000000');
