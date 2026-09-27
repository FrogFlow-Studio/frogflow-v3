/**
 * Память консультанта о покупателе (перенос remember_customer из консультанта
 * BOVI v1). Что покупатель уже сказал — размер, город, телефон — модель
 * записывает инструментом, а в следующих сообщениях видит пометкой «Что
 * известно о покупателе» и не переспрашивает. Чисто.
 *
 * Там же правило v1 «сначала контакт»: покупку менеджеру без телефона не
 * передаём — первый вызов передачи возвращает модели просьбу спросить телефон
 * и способ получения. Второй раз не спрашиваем: не ответил — передаём как есть.
 */
import type Anthropic from "@anthropic-ai/sdk";

export const PROFILE_FIELDS = [
  "looking_for",
  "for_whom",
  "size",
  "color",
  "budget",
  "country",
  "city",
  "delivery",
  "name",
  "phone",
  "notes",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type CustomerProfile = Partial<Record<ProfileField, string>>;

const LABELS: Record<ProfileField, string> = {
  looking_for: "ищет",
  for_whom: "для кого",
  size: "размер",
  color: "цвет",
  budget: "бюджет",
  country: "страна",
  city: "город",
  delivery: "получение",
  name: "имя",
  phone: "телефон",
  notes: "заметки",
};

export const REMEMBER_TOOL: Anthropic.Tool = {
  name: "remember_customer",
  description:
    "Запомнить, что покупатель сказал о своей задаче: что ищет, для кого, размер, цвет, бюджет, страна, город, способ получения, имя, телефон. Вызывайте, когда узнали новое, вместе с ответом покупателю. В следующих сообщениях это придёт в данных диалога («Что известно о покупателе») — не переспрашивайте.",
  input_schema: {
    type: "object",
    properties: {
      looking_for: { type: "string", description: "Что ищет: категория, товар" },
      for_whom: { type: "string", description: "Для кого или для чего" },
      size: { type: "string" },
      color: { type: "string" },
      budget: { type: "string", description: "Бюджет словами покупателя" },
      country: { type: "string" },
      city: { type: "string" },
      delivery: {
        type: "string",
        description: "Как забрать: самовывоз, доставка, служба доставки",
      },
      name: { type: "string" },
      phone: { type: "string", description: "Только если покупатель сам написал" },
      notes: { type: "string", description: "Другое важное для выбора" },
    },
  },
};

/** Новое о покупателе поверх известного; пустые значения старые не стирают. */
export function mergeProfile(
  current: CustomerProfile | undefined,
  input: Record<string, unknown>,
): CustomerProfile {
  const next: CustomerProfile = { ...(current ?? {}) };
  for (const field of PROFILE_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) continue;
    if (field === "phone") {
      // Телефон уходит продавцу — только то, что разбирается как телефон.
      const phone = phoneIn(value);
      if (phone) next.phone = phone;
    } else next[field] = value.trim().slice(0, 200);
  }
  return next;
}

/** Профиль из состояния: мусор и чужие поля отбрасываются. */
export function parseProfile(raw: unknown): CustomerProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return mergeProfile({}, raw as Record<string, unknown>);
}

/** Строка для данных диалога и для заявки менеджеру; пусто — «». */
export function formatProfile(profile: CustomerProfile): string {
  return PROFILE_FIELDS.filter((f) => profile[f])
    .map((f) => `${LABELS[f]}: ${profile[f]}`)
    .join("; ");
}

/**
 * Телефон в тексте покупателя: +7/7/8 и 10 цифр (Казахстан, Россия) или +998
 * и 9 цифр (Узбекистан), с разделителями, как пишут в мессенджере. Серия
 * другой длины — ИИН, номер заказа, карта — телефоном не считается.
 */
export function phoneIn(text: string): string | null {
  for (const m of text.matchAll(/\+?\d[\d\s\-().]*\d/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 11 && /^[78]/.test(digits)) return m[0].trim();
    if (digits.length === 12 && digits.startsWith("998")) return m[0].trim();
  }
  return null;
}

/** Передача, перед которой нужен контакт: покупка или заявка на заказ. */
export function isPurchaseHandoff(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "record_order_lead") return (input.lead_type ?? "order") === "order";
  return tool === "handoff_to_manager" && input.reason === "purchase";
}

export const ASK_CONTACT_RESULT = JSON.stringify({
  ok: false,
  handed_off: false,
  note: "Заказ ещё не передан. Спросите одним сообщением телефон и как удобно получить: город доставки или самовывоз. Ответит — запомните (remember_customer) и передайте. Менеджера в этом ответе не обещайте.",
});
