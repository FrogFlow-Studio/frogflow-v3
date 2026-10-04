-- 19-13: «Почему бот так ответил» — причина ответа бота в журнале диалога.
-- Партия 19, пункт Б13. ТОЛЬКО ДОБАВЛЕНИЕ: одна новая таблица; manager_chat_messages
-- и данные v1 не трогаем. Применяет Яков своим словом; пока не применена, бот пишет
-- сообщения как раньше, а строка «Почему бот так ответил» в «Чате» не показывается.
-- Откат: 19-13-chat-reason.down.sql.

-- Короткая причина («step=cart parsed=codes», до 120 знаков, без текста покупателя);
-- одна строка на сообщение бота. message_id — id из manager_chat_messages, текстом.
CREATE TABLE IF NOT EXISTS manager_chat_reasons (
  bot_id     UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, message_id)
);

ALTER TABLE manager_chat_reasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON manager_chat_reasons FROM tenant_bot;
REVOKE ALL ON manager_chat_reasons FROM anon, authenticated;
GRANT SELECT, INSERT ON manager_chat_reasons TO tenant_bot;

DROP POLICY IF EXISTS tenant_isolation ON manager_chat_reasons;
CREATE POLICY tenant_isolation ON manager_chat_reasons
  FOR ALL TO tenant_bot
  USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON manager_chat_reasons;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON manager_chat_reasons
  FOR EACH ROW EXECUTE FUNCTION force_bot_id();
