-- 19-8: поиск товаров по всей площадке FrogFlow. Партия 19, пункт В8.
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица. Существующие таблицы и колонки не
-- трогаем (база общая с v1; v1 этой таблицы не видит).
-- Применяет Яков своим словом; пока не применена, поиск на /market/search
-- честно пишет «скоро». Откат: 19-8-marketplace-items.down.sql.

-- Снимок товаров магазинов, показываемых на площадке. Пишет только крон
-- (service_role) раз в час: в снимок попадают товары, которые покупатель может
-- купить сейчас; скрытый или закончившийся товар уходит при следующем проходе.
-- Цена в снимке — «на момент» updated_at, источник истины — витрина магазина.
CREATE TABLE IF NOT EXISTS marketplace_items (
  bot_id      UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  -- название и начало описания строчными буквами: по ним ищет поиск
  search_text TEXT NOT NULL DEFAULT '',
  price       NUMERIC NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'KZT',
  -- адрес первой картинки на витрине (/api/img/...), пусто — без фото
  image       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_items_name ON marketplace_items (name, bot_id, product_id);

-- Читает и пишет только service_role (RLS включена); магазин видит свои строки
-- («как ваши товары видны на площадке») по current_bot_id().
ALTER TABLE marketplace_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_items FROM tenant_bot;
REVOKE ALL ON marketplace_items FROM anon, authenticated;
GRANT SELECT ON marketplace_items TO tenant_bot;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_items;
CREATE POLICY tenant_isolation ON marketplace_items
  FOR SELECT TO tenant_bot
  USING (bot_id = current_bot_id());
