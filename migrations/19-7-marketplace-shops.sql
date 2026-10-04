-- 19-7: каталог магазинов площадки FrogFlow. Партия 19, пункт В7.
-- ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица. Существующие таблицы и колонки не
-- трогаем (база общая с v1; v1 этой таблицы не видит).
-- Применяет Яков своим словом; пока не применена, страница /market честно
-- пишет «скоро». Откат: 19-7-marketplace-shops.down.sql.

-- Одна строка на магазин, который согласился показываться на площадке и
-- одобрен оператором. Строки пишет только крон (service_role) раз в час и
-- убирает, когда магазин выключил участие, скрыт оператором или ушёл с v2:
-- таблица — снимок для витрины площадки, источник истины — bots.settings.
CREATE TABLE IF NOT EXISTS marketplace_shops (
  bot_id       UUID PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  -- короткое имя в адресе витрины /s/<slug>
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  -- средняя оценка по товарам магазина и число оценок (В9 уточняет по одобренным)
  rating       NUMERIC(3, 2),
  rating_count INTEGER NOT NULL DEFAULT 0,
  -- заказов за 30 дней, округлённо; заполняет В9
  orders_month   INTEGER NOT NULL DEFAULT 0,
  -- когда магазин на FrogFlow («на FrogFlow с …»); заполняет В9
  since        TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_shops_category ON marketplace_shops (category, bot_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_shops_city ON marketplace_shops (city, bot_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_shops_slug ON marketplace_shops (slug);

-- Пишет только service_role (крон). Магазин может прочитать свою строку («как вас
-- видят на площадке»): RLS по current_bot_id(); чужие строки ему не видны.
-- Публичные страницы площадки читают под service_role.
ALTER TABLE marketplace_shops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_shops FROM tenant_bot;
REVOKE ALL ON marketplace_shops FROM anon, authenticated;
GRANT SELECT ON marketplace_shops TO tenant_bot;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_shops;
CREATE POLICY tenant_isolation ON marketplace_shops
  FOR SELECT TO tenant_bot
  USING (bot_id = current_bot_id());
