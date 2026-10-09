import { type Locale } from "@/core/i18n/locale";
import type { Database } from "@/core/db-types";
import { type Segment } from "./segments";

/** Строка рассылки, фильтр аудитории, потолок запланированных. */

export type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

export type AudienceFilter = {
  country_code?: string;
  /** Сегмент при аудитории «все» (core/broadcasts/segments). */
  segment?: Segment;
  /** Когда отправить (ISO); нет — сразу. Крон не берёт рассылку раньше срока. */
  send_at?: string;
  /** Половина аудитории A/B-теста (core/broadcasts/ab) и какой это вариант. */
  ab?: { group: string; half: 0 | 1; variant: "A" | "B" };
  /**
   * Тексты по языкам покупателя (ru/kk/en/uz); `message_text` — запасной, на языке
   * магазина. Отправитель берёт текст по `bot_users.state.locale` получателя.
   */
  texts?: Partial<Record<Locale, string>>;
  /** Розыгрыш, на который под сообщением кнопка «Участвовать» (core/giveaways). */
  giveaway_id?: string;
};

export type BroadcastChannel = "telegram" | "whatsapp";

/** Сколько рассылок канала можно запланировать наперёд. */
export const MAX_SCHEDULED = 20;

/** Крон и проверка «канал занят» смотрят столько активных: запланированные плюс идущая. */
export const ACTIVE_SCAN = MAX_SCHEDULED + 5;
