import type { Locale } from "@/core/i18n/locale";

/**
 * Покупатель прислал номер в переписке. Бот по умолчанию не отвечает: его
 * ответ делает диалог прочитанным, и продавец пропускал номер (жалоба
 * продавца 08.10). Вместо ответа — уведомление продавцу на языке панели.
 * `who`, `phone` уже экранированы.
 */
export const SELLER_PHONE: Record<
  Locale,
  (
    who: string,
    channel: string,
    phone: string,
    order: { no: number; saved: boolean } | null,
  ) => string
> = {
  ru: (who, ch, phone, o) =>
    `📞 ${who} (${ch}) прислал(а) номер: <b>${phone}</b>` +
    (o ? (o.saved ? `\nЗаписан в заказ №${o.no}.` : `\nПоследний заказ — №${o.no}.`) : "") +
    `\nСвяжитесь с покупателем.`,
  kk: (who, ch, phone, o) =>
    `📞 ${who} (${ch}) нөмір жіберді: <b>${phone}</b>` +
    (o ? (o.saved ? `\n№${o.no} тапсырысқа жазылды.` : `\nСоңғы тапсырыс — №${o.no}.`) : "") +
    `\nСатып алушымен байланысыңыз.`,
  en: (who, ch, phone, o) =>
    `📞 ${who} (${ch}) sent a phone number: <b>${phone}</b>` +
    (o ? (o.saved ? `\nSaved to order #${o.no}.` : `\nLatest order: #${o.no}.`) : "") +
    `\nPlease contact the buyer.`,
  uz: (who, ch, phone, o) =>
    `📞 ${who} (${ch}) raqam yubordi: <b>${phone}</b>` +
    (o ? (o.saved ? `\n№${o.no} buyurtmaga yozildi.` : `\nOxirgi buyurtma — №${o.no}.`) : "") +
    `\nXaridor bilan bog‘laning.`,
};

/**
 * Покупатель написал, что платёж не прошёл, а чек уже был записан: чек снят,
 * заказ снова ждёт оплату (shop/pay-trouble.server). `who`, `said` уже экранированы.
 */
export const SELLER_PROOF_WITHDRAWN: Record<
  Locale,
  (who: string, channel: string, no: number, said: string) => string
> = {
  ru: (who, ch, no, said) =>
    `⚠️ ${who} (${ch}) пишет, что платёж не прошёл: «${said}».\nЧек по заказу №${no} снят, заказ снова ждёт оплату. Не подтверждайте, пока деньги не придут.`,
  kk: (who, ch, no, said) =>
    `⚠️ ${who} (${ch}) төлем өтпегенін жазады: «${said}».\n№${no} тапсырыс бойынша чек алынып тасталды, тапсырыс қайтадан төлемді күтеді. Ақша түспейінше растамаңыз.`,
  en: (who, ch, no, said) =>
    `⚠️ ${who} (${ch}) says the payment didn't go through: “${said}”.\nThe receipt for order #${no} was withdrawn and the order is waiting for payment again. Don't confirm it until the money arrives.`,
  uz: (who, ch, no, said) =>
    `⚠️ ${who} (${ch}) to‘lov o‘tmaganini yozmoqda: «${said}».\n№${no} buyurtma bo‘yicha chek olib tashlandi, buyurtma yana to‘lovni kutmoqda. Pul tushmaguncha tasdiqlamang.`,
};
