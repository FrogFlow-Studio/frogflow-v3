/**
 * Страна покупателя из его слов в Direct и WhatsApp. Ночью 11.10 у AATeach
 * первое сообщение правила спрашивало страну, покупатели отвечали «Я из
 * России», «Беларусь», а бот присылал нумерованный список ещё раз; на «1»
 * покупательнице из России поставил Казахстан. Под постами без кнопки
 * ответ страной оставался без ответа до утра. Понимает модель
 * (core/country), правила — только запасной путь.
 */
import type { Locale } from "@/core/i18n/locale";
import { allPriceCountries } from "@/core/pricing/all-prices";
import { understandCountry } from "@/core/country/understand.server";
import { listActivePaymentMethods } from "@/core/orders/orders";
import { claimStateSection } from "@/core/customers/customers";
import { sellerWroteWithin } from "../manager-guard";
import type { ParsedZernioMessage } from "../message";
import { matchCountry, plain, type CountryOption } from "../shop-flow";
import { BTN, memory, reply, setMode, type Shop, type ShopOutcome } from "./context.server";

/** Отвечаем на страну не чаще, чем раз в это время на одну и ту же страну. */
export const COUNTRY_ACK_MS = 6 * 60 * 60_000;
/** Длиннее — это разговор: страну из него запоминаем, только если её ещё нет. */
const SHORT_TEXT = 40;
const MAX_TEXT = 200;
/** Продавец писал покупателю недавно — бот в разговор не встревает. */
const SELLER_ACTIVE_MS = 30 * 60_000;

/** Как в route: не прочитали переписку — считаем, что продавец не писал. */
async function sellerWroteRecently(s: Shop): Promise<boolean> {
  try {
    const tail = await s.transport.tail(s.accountId, s.conversationId);
    const ours = memory(s.customer).last_reply;
    return sellerWroteWithin(tail, SELLER_ACTIVE_MS, ours ? [ours] : []);
  } catch (e) {
    console.warn(`[zernio-shop] переписка не прочитана ${s.customer.userKey}: ${String(e)}`);
    return false;
  }
}

async function options(s: Shop): Promise<CountryOption[]> {
  const methods = await listActivePaymentMethods(s.ctx);
  return methods.map((x) => ({ code: x.country_code, name: x.country_name }));
}

/**
 * Ответ на вопрос бота «из какой вы страны»: номер или название из списка,
 * иначе — что понял из слов («Я из России», «Махачкала»). null — страны нет.
 */
export async function countryAnswer(s: Shop, text: string): Promise<CountryOption | null> {
  const list = await options(s);
  // Одна страна: шаг ставит её сам, что бы ни ответили.
  if (list.length === 1) return list[0]!;
  const exact = matchCountry(text, list);
  if (exact) return exact;
  if (!/\p{L}/u.test(text)) return null;
  const r = await understandCountry(s.ctx, { text, options: list, asked: true });
  return list.find((o) => o.code === r.code) ?? null;
}

const NOTED: Record<Locale, (country: string) => string> = {
  ru: (c) => `Записал страну: ${c}. Цены будут в валюте этой страны.`,
  kk: (c) => `Елді жазып алдым: ${c}. Бағалар осы елдің валютасында болады.`,
  en: (c) => `Got it, your country is ${c}. Prices will be in its currency.`,
  uz: (c) => `Davlatingizni yozib oldim: ${c}. Narxlar shu davlat valyutasida bo‘ladi.`,
};
const PRESS_BUY: Record<Locale, (button: string) => string> = {
  ru: (b) => `Нажмите «${b}» в сообщении выше — пришлю сумму и как оплатить.`,
  kk: (b) => `Жоғарыдағы хабарламада «${b}» түймесін басыңыз — сома мен төлеу жолын жіберемін.`,
  en: (b) => `Tap “${b}” in the message above and I’ll send the total and how to pay.`,
  uz: (b) => `Yuqoridagi xabarda «${b}» tugmasini bosing — summa va to‘lov usulini yuboraman.`,
};
const SELLER_WILL_ANSWER: Record<Locale, string> = {
  ru: "Продавец ответит здесь, как оплатить.",
  kk: "Сатушы осында қалай төлеу керектігін жазады.",
  en: "The seller will reply here with how to pay.",
  uz: "Sotuvchi shu yerda qanday to‘lashni yozadi.",
};
const OR_CATALOG: Record<Locale, string> = {
  ru: "Чтобы оформить сразу, откройте каталог.",
  kk: "Бірден рәсімдеу үшін каталогты ашыңыз.",
  en: "To order right away, open the catalog.",
  uz: "Darhol buyurtma berish uchun katalogni oching.",
};

/**
 * Страна в обычной переписке — ответ на первое сообщение правила или просто
 * «я из России». Запоминаем её: «Купить» потом не спросит страну второй раз.
 * Сообщение — только страна: бот отвечает один раз (условная запись до
 * отправки), с кнопкой «Купить» выше — зовёт нажать её, без кнопки — честно:
 * продавец пришлёт оплату, а сразу можно через каталог. null — не про страну.
 */
export async function countryFromChat(
  s: Shop,
  msg: ParsedZernioMessage,
  text: string,
): Promise<ShopOutcome | null> {
  const t = text.trim();
  if (!t || t.length > MAX_TEXT || !/\p{L}/u.test(t)) return null;
  const known = s.customer.state.country_code;
  // Страна уже есть, а сообщение длинное — это разговор, не ответ страной.
  if (known && t.length > SHORT_TEXT) return null;
  const list = await options(s);
  if (list.length < 2) return null;
  // Цены во всех валютах: страну спрашивают на шаге оплаты, вместе с суммами.
  if (await allPriceCountries(s.ctx)) return null;
  const r = await understandCountry(s.ctx, { text: t, options: list, asked: false });
  const picked = list.find((o) => o.code === r.code);
  if (!picked) return null;
  if (picked.code !== known) {
    await setMode(s, { country_code: picked.code, country_name: picked.name });
    s.why = `страна из текста: ${picked.name}`;
  }
  if (!r.onlyCountry) return null;
  // Консультант ответит сам и страну увидит в переписке; продавец пишет — не мешаем.
  const { consultantEnabled } = await import("@/core/consultant/engine.server");
  if (await consultantEnabled(s.ctx)) return null;
  if (await sellerWroteRecently(s)) return null;
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur.country_ack_at ?? ""));
    if (cur.country_ack === picked.code && Number.isFinite(at) && Date.now() - at < COUNTRY_ACK_MS)
      return null;
    return { ...cur, country_ack: picked.code, country_ack_at: new Date().toISOString() };
  });
  if (!claimed) return "handled";
  s.customer = claimed;
  const { recentBuyButton } = await import("../automations.server");
  const buy =
    s.platform === "instagram"
      ? await recentBuyButton(s.ctx, { username: msg.senderUsername, senderId: msg.senderId })
      : null;
  const name = plain(picked.name);
  if (buy) {
    await reply(s, `${NOTED[s.locale](name)}\n${PRESS_BUY[s.locale](buy)}`, { force: true });
    return "handled";
  }
  const catalog = s.bot.features.catalog;
  await reply(
    s,
    [NOTED[s.locale](name), SELLER_WILL_ANSWER[s.locale], catalog ? OR_CATALOG[s.locale] : ""]
      .filter(Boolean)
      .join("\n"),
    { force: true, buttons: catalog ? [BTN.catalog(s.m)] : undefined },
  );
  // Оплату под постом без кнопки пришлёт продавец: сообщение остаётся ему.
  return "question";
}
