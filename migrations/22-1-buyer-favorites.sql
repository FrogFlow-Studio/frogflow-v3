-- 22-1: избранное покупателя на площадке FrogFlow. Партия 22, пункт К1.
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица. Существующие таблицы и колонки не
-- трогаем (база общая с v1; v1 этой таблицы не видит). Баллы, заказы и
-- адреса остаются в магазине; здесь только «какой человек отметил какой товар».
-- Человек — подтверждённое удостоверение (marketplace_buyers, В17): почта
-- без подтверждения избранного не открывает.
-- Применяет Яков своим словом; пока не применена, раздел «Избранное» на
-- площадке пишет «скоро», остальное работает. Откат: 22-1-buyer-favorites.down.sql.

CREATE TABLE IF NOT EXISTS buyer_favorites (
  buyer_id   UUID NOT NULL REFERENCES marketplace_buyers(id) ON DELETE CASCADE,
  bot_id     UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, bot_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_favorites_buyer ON buyer_favorites (buyer_id, created_at DESC);

-- RLS включена без политик: общие для магазинов данные читает и пишет только
-- service_role через код, который сам проверяет подтверждение входа.
ALTER TABLE buyer_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON buyer_favorites FROM tenant_bot, anon, authenticated;
