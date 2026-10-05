-- 22-2: подборки площадки FrogFlow («Для школы», «Подарки»…). Партия 22, пункт Л3.
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица. Существующие таблицы и колонки не трогаем
-- (база общая с v1; v1 этой таблицы не видит). Подборку собирает оператор из товаров
-- площадки; состав — список пар «магазин — товар» в items, не больше 24. Продавец и
-- покупатель подборки только читают (через код площадки).
-- rev — номер правки: оператор меняет подборку условным обновлением, чтобы две вкладки
-- не затирали друг друга.
-- Применяет Яков своим словом; пока не применена, на главной площадки подборок нет,
-- остальное работает. Откат: 22-2-market-collections.down.sql.

CREATE TABLE IF NOT EXISTS market_collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- {"ru": "...", "kk": "...", "en": "...", "uz": "..."}: ru обязателен, остальные по желанию
  title      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{"shop_id": "<uuid магазина>", "product_id": "<uuid товара>"}, ...]
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  position   INTEGER NOT NULL DEFAULT 0,
  published  BOOLEAN NOT NULL DEFAULT false,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_collections_order ON market_collections (published, position, id);

-- RLS включена без политик: читает и пишет только service_role через код площадки.
ALTER TABLE market_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON market_collections FROM tenant_bot, anon, authenticated;
