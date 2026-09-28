import type { ConsultantProduct } from "./catalog";

/**
 * Напоминание покупателю, который пропал после ответа с товаром (перенос
 * consultant-v2/follow-up.ts v1). Человек спросил цену, бот ответил — и
 * тишина. Живой менеджер через несколько часов напишет одну строку:
 * «Остались вопросы по …?». Бот делает то же, один раз на одну паузу:
 * - разговор был о товаре (в состоянии есть товары последней выдачи);
 * - с ответа бота прошло от 3 до 23 часов: Instagram разрешает писать первым
 *   только 24 часа после сообщения покупателя;
 * - не в нерабочие часы магазина, не на паузе и не после передачи менеджеру.
 * Текст — шаблоном, без модели. Выключено, пока продавец не включил
 * consultant_followup = "on" (та же строка app_settings, что у v1).
 */
export const FOLLOW_UP_SETTING_KEY = "consultant_followup";
export const FOLLOW_UP_AFTER_MS = 3 * 60 * 60 * 1000;
export const FOLLOW_UP_UNTIL_MS = 23 * 60 * 60 * 1000;

export type FollowUpState = {
  recent?: { role: "customer" | "assistant"; text: string }[];
  last_product_ids?: string[];
  last_reply_at?: string;
  paused_until?: string;
  /** Напоминание уже ушло после ответа с этим временем. */
  followup_for?: string;
  /** Имя v1 у диалогов до переезда. */
  v2_followup_for?: string;
};

/** Модель без размера и цвета: «Uchino Полотенце махровое Zero Twist». */
export function modelName(name: string): string {
  return name
    .replace(/[\s,]*\(.*$/, "")
    .replace(/[\s,]*\d{2,3}\s*[xх×*]\s*\d{2,3}.*$/i, "")
    .replace(/,?\s*цвет.*$/i, "")
    .trim();
}

export function followUpText(state: FollowUpState, catalog: ConsultantProduct[]): string | null {
  const id = state.last_product_ids?.[0];
  const product = id ? catalog.find((p) => p.id === id) : undefined;
  if (!product) return null;
  const model = modelName(product.name);
  if (!model) return null;
  return `Остались вопросы по ${model}? Подскажу по размеру, цвету или доставке.`;
}

export function isFollowUpCandidate(state: FollowUpState, now: Date, offHours: boolean): boolean {
  if (offHours) return false;
  // Пауза — менеджер в диалоге или передача: напоминать от бота нельзя.
  if (state.paused_until && Date.parse(state.paused_until) > now.getTime()) return false;
  if (!state.last_product_ids?.length) return false;
  const at = Date.parse(state.last_reply_at ?? "");
  if (!Number.isFinite(at)) return false;
  const silence = now.getTime() - at;
  if (silence < FOLLOW_UP_AFTER_MS || silence > FOLLOW_UP_UNTIL_MS) return false;
  return (state.followup_for ?? state.v2_followup_for) !== state.last_reply_at;
}

/** История с напоминанием: к последней реплике бота, чтобы роли чередовались. */
export function recentWithFollowUp(
  state: Pick<FollowUpState, "recent">,
  text: string,
): NonNullable<FollowUpState["recent"]> {
  const recent = [...(state.recent ?? [])];
  const last = recent[recent.length - 1];
  if (last?.role === "assistant") {
    recent[recent.length - 1] = { ...last, text: `${last.text}\n\n${text}`.slice(0, 1200) };
  } else {
    recent.push({ role: "assistant", text });
  }
  return recent;
}
