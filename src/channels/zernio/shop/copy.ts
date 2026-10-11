import type { Locale } from "@/core/i18n/locale";
import type { Tenant } from "@/core/tenant/types";
import type { ZernioPlatform } from "../platform";
import { COPY, escapeHtml, type Msg } from "@/channels/telegram/copy";
import {
  BOT_TEXT_VARS,
  MSG_PROPS,
  WIRED,
  customText,
  fillText,
  type BotTextChannel,
} from "@/core/bot-texts/registry";

/**
 * Instagram: вопросы о стране и языке — номером из списка под ними. Без
 * подсказки покупатели пишут словами и ходят по кругу (AATeach, 11.10:
 * Анастасия попросила дописать). В WhatsApp выбор — интерактивным списком.
 */
export const DIGIT_HINT: Record<Locale, string> = {
  ru: "👇 В ответ отправьте только цифру. Текст писать не нужно.",
  kk: "👇 Жауапқа тек санды жіберіңіз. Мәтін жазудың қажеті жоқ.",
  en: "👇 Reply with the number only. No need to type text.",
  uz: "👇 Javobga faqat raqamni yuboring. Matn yozish shart emas.",
};
const DIGIT_PROPS = ["chooseCountry", "choosePayCountry", "chooseDeliveryLanguage"] as const;

/** Стандартный словарь Direct: для Instagram — с подсказкой «только цифру». */
export function directBase(platform: ZernioPlatform, locale: Locale): Msg {
  const base = COPY[locale];
  if (platform !== "instagram") return base;
  const out = { ...base };
  for (const prop of DIGIT_PROPS) out[prop] = `${base[prop]}\n${DIGIT_HINT[locale]}`;
  return out;
}

/**
 * Словарь бота для Direct: стандартные фразы, а где продавец задал свой текст
 * на странице «Тексты бота» (канал Instagram) — его, с подставленными
 * {order}/{email}. Ключ, не подключённый к каналу (WIRED), не действует.
 */
export function directCopy(
  tenant: Pick<Tenant, "settings">,
  platform: ZernioPlatform,
  locale: Locale,
): Msg {
  const base = directBase(platform, locale);
  const channel = platform as BotTextChannel;
  const keys = WIRED[channel] ?? [];
  if (!keys.length || !tenant.settings.bot_texts) return base;
  let out: Msg | null = null;
  for (const key of keys) {
    const custom = customText(tenant, key, channel, locale);
    if (custom === null) continue;
    // Ответ проходит через plain(): экранируем, чтобы «<3» и «&» дошли как написаны.
    const tpl = escapeHtml(custom);
    const names = BOT_TEXT_VARS[key];
    out ??= { ...base };
    for (const prop of MSG_PROPS[key] ?? []) {
      const std = (base as Record<string, unknown>)[prop];
      (out as Record<string, unknown>)[prop] =
        typeof std === "function"
          ? (...args: unknown[]) =>
              fillText(
                tpl,
                Object.fromEntries(names.map((n, i) => [n, escapeHtml(String(args[i] ?? ""))])),
              )
          : tpl;
    }
  }
  return out ?? base;
}
