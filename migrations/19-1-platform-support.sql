-- 19-1: чат продавца с платформой (поддержка в админке). Партия 19, пункт Ч1.
-- ТОЛЬКО ДОБАВЛЕНИЕ: три новые таблицы. Существующие таблицы и колонки не
-- трогаем (база общая с v1; v1 этих таблиц не видит).
-- Применяет Яков своим словом; пока не применена, раздел «Поддержка» в
-- админке выключен и честно пишет «скоро». Откат: 19-1-platform-support.down.sql.

-- Обращение: один открытый разговор продавца с платформой. Закрытое («решено»)
-- не удаляется; новое сообщение продавца открывает следующее обращение.
CREATE TABLE IF NOT EXISTS platform_threads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                   UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- new | in_progress | waiting_seller | resolved (Ч9)
  status                   TEXT NOT NULL DEFAULT 'new'
                             CHECK (status IN ('new', 'in_progress', 'waiting_seller', 'resolved')),
  -- метки оператора (Ч9): «оплата», «Instagram», «ошибка»…
  labels                   TEXT[] NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seller_message_at   TIMESTAMPTZ,
  last_operator_message_at TIMESTAMPTZ,
  -- первый ответ оператора и срок, до которого ответить (Ч11)
  first_response_at        TIMESTAMPTZ,
  due_at                   TIMESTAMPTZ,
  -- сколько сообщений другая сторона ещё не прочитала (счётчик в меню, Ч2)
  seller_unread            INTEGER NOT NULL DEFAULT 0,
  operator_unread          INTEGER NOT NULL DEFAULT 0,
  -- версия записи: условные обновления сверяют её (маленькое поле, не весь текст)
  rev                      INTEGER NOT NULL DEFAULT 0
);

-- Не больше одного незакрытого обращения у магазина: два одновременных первых
-- сообщения не заведут два разговора.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_threads_open
  ON platform_threads (bot_id) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_platform_threads_bot_at
  ON platform_threads (bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_threads_status_at
  ON platform_threads (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS platform_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id         UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  thread_id      UUID NOT NULL REFERENCES platform_threads(id) ON DELETE CASCADE,
  -- кто написал: seller | operator
  author         TEXT NOT NULL CHECK (author IN ('seller', 'operator')),
  author_name    TEXT,
  body           TEXT NOT NULL DEFAULT '',
  -- скриншот в Storage: ключ вида <bot_id>/<hex>.<ext> (Ч3)
  attachment_key TEXT,
  -- откуда написали: {"page": "/admin/orders", "order_no": 15} (Ч3)
  context        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- когда прочитала другая сторона
  read_at        TIMESTAMPTZ,
  -- «один раз»: отметка ставится условным обновлением до отправки уведомления (Ч2)
  notified_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_platform_messages_thread_at
  ON platform_messages (thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_platform_messages_bot_at
  ON platform_messages (bot_id, created_at DESC);

-- Заметка оператора к обращению (Ч9): продавцу не видна ни при каких условиях,
-- у роли tenant_bot на таблицу нет прав и нет политик.
CREATE TABLE IF NOT EXISTS platform_thread_notes (
  thread_id  UUID PRIMARY KEY REFERENCES platform_threads(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE platform_threads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_thread_notes ENABLE ROW LEVEL SECURITY;

-- Права точечно: ALTER DEFAULT PRIVILEGES выдал бы tenant_bot всё.
REVOKE ALL ON platform_threads, platform_messages, platform_thread_notes FROM tenant_bot;
REVOKE ALL ON platform_threads, platform_messages, platform_thread_notes FROM anon, authenticated;
GRANT SELECT, INSERT ON platform_threads, platform_messages TO tenant_bot;
-- Продавец меняет только счётчики и время своих сообщений; статус, метки,
-- срок и первый ответ ставит оператор (service_role, обходит RLS).
GRANT UPDATE (last_message_at, last_seller_message_at, operator_unread, seller_unread, status, rev)
  ON platform_threads TO tenant_bot;
GRANT UPDATE (read_at) ON platform_messages TO tenant_bot;

-- Обращение: продавец читает своё, заводит новое только «чистым» (статус new,
-- без меток, срока и ответов оператора); статус, метки, срок и первый ответ
-- ставит оператор, продавцу доступен только переход waiting_seller → in_progress.
DROP POLICY IF EXISTS tenant_isolation ON platform_threads;
DROP POLICY IF EXISTS tenant_select ON platform_threads;
CREATE POLICY tenant_select ON platform_threads
  FOR SELECT TO tenant_bot
  USING (bot_id = current_bot_id());
DROP POLICY IF EXISTS tenant_insert_clean ON platform_threads;
CREATE POLICY tenant_insert_clean ON platform_threads
  FOR INSERT TO tenant_bot
  WITH CHECK (
    bot_id = current_bot_id() AND status = 'new' AND labels = '{}'
    AND first_response_at IS NULL AND due_at IS NULL AND last_operator_message_at IS NULL
  );
DROP POLICY IF EXISTS tenant_update_open ON platform_threads;
DROP POLICY IF EXISTS tenant_update ON platform_threads;
CREATE POLICY tenant_update ON platform_threads
  FOR UPDATE TO tenant_bot
  USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());
-- Из статусов продавцу доступен один переход: ответил оператору на вопрос —
-- waiting_seller → in_progress. Остальное меняет оператор (service_role).
CREATE OR REPLACE FUNCTION platform_threads_seller_status() RETURNS trigger AS $$
BEGIN
  IF current_user = 'tenant_bot' AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'waiting_seller' AND NEW.status = 'in_progress') THEN
    RAISE EXCEPTION 'platform_threads: статус меняет оператор' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_seller_status ON platform_threads;
CREATE TRIGGER trg_seller_status BEFORE UPDATE OF status ON platform_threads
  FOR EACH ROW EXECUTE FUNCTION platform_threads_seller_status();
-- Сообщения: продавец читает и отмечает прочитанным своё, а вставляет только
-- от своего имени. Без отдельной политики на INSERT ключ арендатора мог бы
-- записать сообщение с author = 'operator' — ответ «от поддержки».
DROP POLICY IF EXISTS tenant_isolation ON platform_messages;
CREATE POLICY tenant_isolation ON platform_messages
  FOR SELECT TO tenant_bot
  USING (bot_id = current_bot_id());
DROP POLICY IF EXISTS tenant_update_read ON platform_messages;
CREATE POLICY tenant_update_read ON platform_messages
  FOR UPDATE TO tenant_bot
  USING (bot_id = current_bot_id() AND author = 'operator')
  WITH CHECK (bot_id = current_bot_id() AND author = 'operator');
DROP POLICY IF EXISTS tenant_insert_seller ON platform_messages;
CREATE POLICY tenant_insert_seller ON platform_messages
  FOR INSERT TO tenant_bot
  WITH CHECK (bot_id = current_bot_id() AND author = 'seller' AND notified_at IS NULL AND read_at IS NULL);

DROP TRIGGER IF EXISTS trg_force_bot_id ON platform_threads;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON platform_threads
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
DROP TRIGGER IF EXISTS trg_force_bot_id ON platform_messages;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON platform_messages
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
