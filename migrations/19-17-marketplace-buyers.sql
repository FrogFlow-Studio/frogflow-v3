-- 19-17: аккаунт покупателя на площадке FrogFlow. Партия 19, пункт В17.
-- ТОЛЬКО ДОБАВЛЕНИЕ: две новые таблицы. Существующие таблицы и колонки не
-- трогаем (база общая с v1; v1 этих таблиц не видит). bot_users, loyalty_points
-- и заказы остаются в магазине: площадка хранит только «кто этот человек» и
-- какие его профили в магазинах он подтвердил.
-- Применяет Яков своим словом; пока не применена, вход идёт по магазину, как раньше.
-- Откат: 19-17-marketplace-buyers.down.sql.

-- Человек на площадке: подтверждённое удостоверение в канале (Telegram id или
-- телефон WhatsApp). Почта ничего не открывает, поэтому её здесь нет.
CREATE TABLE IF NOT EXISTS marketplace_buyers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  channel_id   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_buyers_channel ON marketplace_buyers (channel, channel_id);

-- Связь «человек → его профиль в магазине» (bot_users.user_key). Профиль в
-- магазине принадлежит не больше чем одному человеку: первичный ключ (bot_id, user_key).
CREATE TABLE IF NOT EXISTS marketplace_buyer_links (
  bot_id      UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_key    TEXT NOT NULL,
  buyer_id    UUID NOT NULL REFERENCES marketplace_buyers(id) ON DELETE CASCADE,
  -- чем подтверждено: вход через виджет Telegram магазина или код в бот
  verified_by TEXT NOT NULL CHECK (verified_by IN ('telegram_login', 'code')),
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_key)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_buyer_links_buyer ON marketplace_buyer_links (buyer_id, bot_id);

-- RLS включена без политик: общие для магазинов данные читает и пишет только
-- service_role через код, который сам проверяет подтверждение входа.
ALTER TABLE marketplace_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_buyer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_buyers FROM tenant_bot, anon, authenticated;
REVOKE ALL ON marketplace_buyer_links FROM tenant_bot, anon, authenticated;
