-- 19-5: лента новостей платформы («Что нового» в админке). Партия 19, пункты Ч5–Ч7.
-- ТОЛЬКО ДОБАВЛЕНИЕ: три новые таблицы. Существующее не трогаем (база общая с v1).
-- Применяет Яков своим словом; пока не применена, раздел «Что нового» выключен
-- и честно пишет «скоро». Откат: 19-5-platform-news.down.sql.

-- Новость платформы. Общая для всех клиентов (без bot_id); пишет оператор.
CREATE TABLE IF NOT EXISTS platform_news (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- заголовок и текст на четырёх языках: {"ru": "...", "kk": "...", "en": "...", "uz": "..."}
  title        JSONB NOT NULL,
  body         JSONB NOT NULL,
  -- для каких уровней тарифа (basic | pro | business | custom); пустой массив — для всех
  plans        TEXT[] NOT NULL DEFAULT '{}',
  -- кнопка действия (Ч6): {"kind": "module", "module": "giveaways"} или {"kind": "link", "path": "/admin/help?a=bot-silent"}
  action       JSONB,
  -- опрос (Ч7): {"options": [{"ru": "...", "kk": "...", "en": "...", "uz": "..."}, ...]}, 2–4 варианта
  poll         JSONB,
  -- NULL — черновик, продавцы не видят
  published_at TIMESTAMPTZ,
  archived     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_news_published
  ON platform_news (published_at DESC) WHERE published_at IS NOT NULL;

-- Прочитано: одна строка на магазин и новость.
CREATE TABLE IF NOT EXISTS platform_news_reads (
  bot_id  UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  news_id UUID NOT NULL REFERENCES platform_news(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, news_id)
);

-- Голос в опросе: один на магазин и новость (первичный ключ — защита от
-- двойного клика и гонки: второй голос падает на 23505).
CREATE TABLE IF NOT EXISTS platform_news_votes (
  bot_id    UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  news_id   UUID NOT NULL REFERENCES platform_news(id) ON DELETE CASCADE,
  option_ix INTEGER NOT NULL CHECK (option_ix BETWEEN 0 AND 3),
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, news_id)
);

ALTER TABLE platform_news       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_news_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_news_votes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON platform_news, platform_news_reads, platform_news_votes FROM tenant_bot;
REVOKE ALL ON platform_news, platform_news_reads, platform_news_votes FROM anon, authenticated;
-- Продавец читает опубликованные новости, отмечает прочитанное и голосует;
-- менять и удалять голоса и новости он не может.
GRANT SELECT ON platform_news TO tenant_bot;
GRANT SELECT, INSERT ON platform_news_reads, platform_news_votes TO tenant_bot;

DROP POLICY IF EXISTS tenant_reads_published ON platform_news;
CREATE POLICY tenant_reads_published ON platform_news
  FOR SELECT TO tenant_bot
  USING (published_at IS NOT NULL AND published_at <= now() AND NOT archived);

DROP POLICY IF EXISTS tenant_isolation ON platform_news_reads;
CREATE POLICY tenant_isolation ON platform_news_reads
  FOR ALL TO tenant_bot
  USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());
DROP POLICY IF EXISTS tenant_isolation ON platform_news_votes;
CREATE POLICY tenant_isolation ON platform_news_votes
  FOR ALL TO tenant_bot
  USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON platform_news_reads;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON platform_news_reads
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
DROP TRIGGER IF EXISTS trg_force_bot_id ON platform_news_votes;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON platform_news_votes
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
