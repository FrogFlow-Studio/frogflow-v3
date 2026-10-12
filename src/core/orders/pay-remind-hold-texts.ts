import type { Locale } from "@/core/i18n/locale";
import type { PayRemindHold } from "./pay-remind";

/**
 * Подсказка продавцу, когда напоминание об оплате придержано (core/orders/pay-remind):
 * заказ, покупатель и почему — и что сделать. Имя и ссылку экранирует вызывающий.
 */
const WORDS: Record<
  Locale,
  {
    title: (no: number) => string;
    ticket: (n: number) => string;
    later: (n: number) => string;
    act: string;
  }
> = {
  ru: {
    title: (no) => `⏸ Заказ №${no}: напоминание об оплате не отправлено`,
    ticket: (n) =>
      `У покупателя открыто обращение #${n}: возможно, ему нужен другой товар или чек пришёл вам напрямую.`,
    later: (n) => `После этого заказа покупатель оформил заказ №${n}.`,
    act: "Отмените заказ или подтвердите оплату.",
  },
  kk: {
    title: (no) => `⏸ №${no} тапсырыс: төлем туралы еске салу жіберілмеді`,
    ticket: (n) =>
      `Сатып алушыда #${n} ашық өтініш бар: оған басқа тауар керек болуы мүмкін немесе чек сізге тікелей келген.`,
    later: (n) => `Осы тапсырыстан кейін сатып алушы №${n} тапсырысты рәсімдеді.`,
    act: "Тапсырысты болдырмаңыз немесе төлемді растаңыз.",
  },
  en: {
    title: (no) => `⏸ Order #${no}: payment reminder not sent`,
    ticket: (n) =>
      `The customer has an open request #${n}: they may want a different product, or the receipt came to you directly.`,
    later: (n) => `After this order the customer placed order #${n}.`,
    act: "Cancel the order or confirm the payment.",
  },
  uz: {
    title: (no) => `⏸ №${no} buyurtma: to‘lov eslatmasi yuborilmadi`,
    ticket: (n) =>
      `Xaridorda #${n} ochiq murojaat bor: unga boshqa mahsulot kerak bo‘lishi mumkin yoki chek sizga to‘g‘ridan-to‘g‘ri kelgan.`,
    later: (n) => `Bu buyurtmadan keyin xaridor №${n} buyurtmani rasmiylashtirdi.`,
    act: "Buyurtmani bekor qiling yoki to‘lovni tasdiqlang.",
  },
};

export function payRemindHeldText(
  locale: Locale,
  no: number,
  why: PayRemindHold,
  who: string,
  link: string,
): string {
  const w = WORDS[locale] ?? WORDS.ru;
  const reason = why.reason === "ticket" ? w.ticket(why.ticket) : w.later(why.laterNo);
  return `<b>${w.title(no)}</b>\n👤 ${who}\n${reason}\n${w.act}\n${link}`;
}
