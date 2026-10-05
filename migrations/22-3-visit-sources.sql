-- 22-3: «Откуда заходят на витрину» — счётчик визитов по источникам и дням.
-- Партия 22, путь У, пункт У1. ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица, существующее не
-- трогается (база общая с v1). Применяет Яков своим словом; пока таблицы нет, визиты не
-- считаются, а воронка и «Источники» в аналитике показываются без визитов.
-- Откат: 22-3-visit-sources.down.sql.
--
-- Без личных данных: только счётчик. Ни адреса, ни браузера, ни cookie, ни идентификатора
-- посетителя; источник — группа (direct, search, market, tag:весна …), не больше 64 знаков.
-- Одна строка = магазин + день + источник + этап; запись — небольшим условным обновлением
-- счётчика n (код читает n и обновляет «где n прежнее»).

CREATE TABLE IF NOT EXISTS visit_sources (
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  day    DATE NOT NULL,
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 64),
  -- visit — открыли витрину; product — посмотрели товар
  stage  TEXT NOT NULL CHECK (stage IN ('visit', 'product')),
  n      INTEGER NOT NULL DEFAULT 1 CHECK (n >= 0),
  PRIMARY KEY (bot_id, day, source, stage)
);

ALTER TABLE visit_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visit_sources FROM tenant_bot;
REVOKE ALL ON visit_sources FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON visit_sources TO tenant_bot;

DROP POLICY IF EXISTS tenant_isolation ON visit_sources;
CREATE POLICY tenant_isolation ON visit_sources
  FOR ALL TO tenant_bot
  USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON visit_sources;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON visit_sources
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
