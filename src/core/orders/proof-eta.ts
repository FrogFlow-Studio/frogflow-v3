import type { Locale } from "@/core/i18n/locale";
import { hourIn } from "@/core/consultant/pricelist/mode";
import { cleanWorkHours, hhmm } from "@/core/bot-texts/registry";
import { cleanChecker } from "./proof-checker";

/**
 * «Чек получен — кто и когда проверит» (settings.delivery.proof_eta, по
 * умолчанию выключено): вместо «Ожидайте подтверждения продавца» покупатель
 * видит, кто проверяет чек и до какого часа, и что ответ придёт сюда же.
 * Часы — рабочие часы магазина (`work_hours`, «Тексты бота»); их нет — без
 * времени. Простой текст: имя проверяющего вписывает продавец.
 */

export type ProofEtaInput = {
  no: number;
  /** Кто проверяет чек; пусто — «продавец». */
  checker?: string | null;
  workHours: unknown;
  now: Date;
  timezone: string;
};

type When = { kind: "until"; at: string } | { kind: "today" | "tomorrow"; at: string } | null;

function when(workHours: unknown, now: Date, timezone: string): When {
  const h = cleanWorkHours(workHours);
  if (!h) return null;
  const hour = hourIn(now, timezone);
  const open =
    h.open < h.close ? hour >= h.open && hour < h.close : hour >= h.open || hour < h.close;
  if (open) return { kind: "until", at: hhmm(h.close) };
  return { kind: hour < h.open ? "today" : "tomorrow", at: hhmm(h.open) };
}

const WORDS: Record<
  Locale,
  {
    seller: string;
    head: (no: number) => string;
    check: (who: string, w: When) => string;
    tail: string;
  }
> = {
  ru: {
    seller: "Продавец",
    head: (no) => `✅ Чек по заказу #${no} получен.`,
    check: (who, w) =>
      !w
        ? `${who} проверит его и подтвердит заказ.`
        : w.kind === "until"
          ? `${who} проверит его сегодня до ${w.at}.`
          : `${who} проверит его ${w.kind === "today" ? "сегодня" : "завтра"} после ${w.at}.`,
    tail: "Как только чек проверят, бот сразу напишет сюда — ничего больше делать не нужно.",
  },
  kk: {
    seller: "Сатушы",
    head: (no) => `✅ #${no} тапсырыс бойынша чек алынды.`,
    check: (who, w) =>
      !w
        ? `${who} оны тексеріп, тапсырысты растайды.`
        : w.kind === "until"
          ? `${who} оны бүгін ${w.at} дейін тексереді.`
          : `${who} оны ${w.kind === "today" ? "бүгін" : "ертең"} ${w.at} кейін тексереді.`,
    tail: "Чек тексерілісімен бот осында бірден жазады — басқа ештеңе істеудің қажеті жоқ.",
  },
  en: {
    seller: "The seller",
    head: (no) => `✅ Receipt for order #${no} received.`,
    check: (who, w) =>
      !w
        ? `${who} will check it and confirm the order.`
        : w.kind === "until"
          ? `${who} will check it today before ${w.at}.`
          : `${who} will check it ${w.kind === "today" ? "today" : "tomorrow"} after ${w.at}.`,
    tail: "As soon as it is checked, the bot will message you here — nothing else to do.",
  },
  uz: {
    seller: "Sotuvchi",
    head: (no) => `✅ #${no}-buyurtma bo‘yicha chek qabul qilindi.`,
    check: (who, w) =>
      !w
        ? `${who} uni tekshirib, buyurtmani tasdiqlaydi.`
        : w.kind === "until"
          ? `${who} uni bugun ${w.at} gacha tekshiradi.`
          : `${who} uni ${w.kind === "today" ? "bugun" : "ertaga"} ${w.at} dan keyin tekshiradi.`,
    tail: "Chek tekshirilishi bilan bot shu yerga darhol yozadi — boshqa hech narsa qilish shart emas.",
  },
};

export function proofEtaText(locale: Locale, p: ProofEtaInput): string {
  const w = WORDS[locale] ?? WORDS.ru;
  const who = cleanChecker(p.checker) ?? w.seller;
  return [w.head(p.no), w.check(who, when(p.workHours, p.now, p.timezone)), w.tail].join(" ");
}
