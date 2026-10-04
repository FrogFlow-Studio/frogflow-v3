import type { Locale } from "@/core/i18n/locale";
import nodemailer from "nodemailer";
import { beforeExternalEffect } from "@/lib/external-effects";
import { PREVIEW_SEND_OFF, previewReadonly } from "@/lib/preview";
import { env } from "@/config/env";
import { maskEmailsIn } from "@/lib/log-mask";

/**
 * Письма покупателям через SMTP платформы (перенос из v1). Зачем: Instagram
 * Direct не принимает документы вложением, а окно ответа — 24 часа; письмо
 * снимает оба ограничения. Материалы уходят подписанными ссылками, не
 * вложениями: файлы бывают до 100 МБ, почта столько не примет.
 */
export function isMailConfigured(): boolean {
  const e = env();
  return Boolean(e.SMTP_HOST?.trim() && e.SMTP_USER?.trim() && e.SMTP_PASSWORD?.trim());
}

export type MailLink = { name: string; url: string };

export type Mailer = (mail: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => Promise<{ ok: boolean; error?: string }>;

/** Предел ожидания SMTP-сервера на каждом шаге (соединение, приветствие, ответ). */
export const SMTP_TIMEOUT_MS = 15_000;

export const smtpMailer: Mailer = async (mail) => {
  const e = env();
  if (!isMailConfigured()) return { ok: false, error: "SMTP не настроен" };
  const port = e.SMTP_PORT || 465;
  try {
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
      // Без своих сроков nodemailer ждёт соединение 2 минуты, а ответ сервера — 10: больше бюджета функции.
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    if (previewReadonly()) return { ok: false, error: PREVIEW_SEND_OFF };
    await beforeExternalEffect();
    await transport.sendMail({ from: e.SMTP_FROM || e.SMTP_USER, ...mail });
    return { ok: true };
  } catch (err) {
    // Ответ SMTP часто содержит адрес покупателя — в журнал и Sentry только маской.
    return { ok: false, error: maskEmailsIn(err instanceof Error ? err.message : String(err)) };
  }
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Текст и HTML письма с материалами — чистая часть, проверяется тестом. */
export function orderMaterialsMail(p: {
  orderNo: number | string;
  shopName: string;
  files: MailLink[];
  linkDays: number;
}): { subject: string; text: string; html: string } {
  const many = p.files.length > 1;
  const subject = `Ваш заказ №${p.orderNo} — материалы внутри`;
  const text = [
    "Здравствуйте!",
    "",
    `Спасибо за покупку. Ваш заказ №${p.orderNo} подтверждён.`,
    "",
    many ? "Материалы доступны по ссылкам:" : "Материал доступен по ссылке:",
    ...p.files.map((f) => `• ${f.name}\n  ${f.url}`),
    "",
    `Ссылки действуют ${p.linkDays} дней — пожалуйста, скачайте файлы на своё устройство.`,
    "",
    "Если что-то не открывается, просто ответьте на это письмо.",
    "",
    p.shopName,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
<p>Здравствуйте!</p>
<p>Спасибо за покупку. Ваш заказ <strong>№${esc(String(p.orderNo))}</strong> подтверждён.</p>
<p>${many ? "Материалы доступны по ссылкам:" : "Материал доступен по ссылке:"}</p>
<ul style="padding-left:18px">${p.files
    .map(
      (f) =>
        `<li style="margin-bottom:8px"><a href="${esc(f.url)}" style="color:#0b57d0">${esc(f.name)}</a></li>`,
    )
    .join("")}</ul>
<p style="color:#5f6368">Ссылки действуют ${p.linkDays} дней — пожалуйста, скачайте файлы на своё устройство.</p>
<p>Если что-то не открывается, просто ответьте на это письмо.</p>
<p>${esc(p.shopName)}</p>
</div>`;
  return { subject, text, html };
}

/**
 * Напоминание о неоплаченном заказе с сайта (core/storefront/web-remind):
 * ссылка на страницу заказа, где реквизиты, QR и оплата картой.
 */
export function unpaidOrderMail(p: {
  orderNo: number | string;
  shopName: string;
  amount: string;
  url: string;
  hoursLeft: number;
}): { subject: string; text: string; html: string } {
  const subject = `Заказ №${p.orderNo} ждёт оплаты`;
  const text = [
    "Здравствуйте!",
    "",
    `Ваш заказ №${p.orderNo} в магазине «${p.shopName}» ещё не оплачен. К оплате: ${p.amount}.`,
    "",
    "Оплатить и загрузить чек можно на странице заказа:",
    p.url,
    "",
    `Если заказ не оплатить в ближайшие ${p.hoursLeft} ч, он отменится.`,
    "Если вы уже оплатили или передумали, просто не отвечайте на это письмо.",
    "",
    p.shopName,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
<p>Здравствуйте!</p>
<p>Ваш заказ <strong>№${esc(String(p.orderNo))}</strong> в магазине «${esc(p.shopName)}» ещё не оплачен. К оплате: <strong>${esc(p.amount)}</strong>.</p>
<p><a href="${esc(p.url)}" style="color:#0b57d0">Открыть заказ и оплатить</a></p>
<p style="color:#5f6368">Если заказ не оплатить в ближайшие ${p.hoursLeft} ч, он отменится. Если вы уже оплатили или передумали, просто не отвечайте на это письмо.</p>
<p>${esc(p.shopName)}</p>
</div>`;
  return { subject, text, html };
}

const GIFT_MAIL: Record<
  Locale,
  {
    subject: (amount: string, no: number | string) => string;
    hello: string;
    intro: (shop: string, amount: string) => [string, string];
    howTo: string;
    shop: string;
    goShop: string;
  }
> = {
  ru: {
    subject: (a, n) => `Подарочный сертификат на ${a} — заказ №${n}`,
    hello: "Здравствуйте!",
    intro: (s, a) => [`Спасибо за покупку. Ваш подарочный сертификат магазина «${s}» на `, a],
    howTo: "Код вводится при оформлении заказа в поле «Подарочный сертификат».",
    shop: "Магазин:",
    goShop: "Перейти в магазин",
  },
  kk: {
    subject: (a, n) => `${a} сыйлық сертификаты — №${n} тапсырыс`,
    hello: "Сәлеметсіз бе!",
    intro: (s, a) => [`Сатып алғаныңызға рақмет. «${s}» дүкенінің сыйлық сертификаты: `, a],
    howTo: "Кодты тапсырысты рәсімдеу кезінде «Сыйлық сертификаты» жолына енгізіңіз.",
    shop: "Дүкен:",
    goShop: "Дүкенге өту",
  },
  en: {
    subject: (a, n) => `Gift certificate for ${a} — order #${n}`,
    hello: "Hello!",
    intro: (s, a) => [`Thank you for your purchase. Your gift certificate from “${s}” for `, a],
    howTo: "Enter the code at checkout in the “Gift certificate” field.",
    shop: "Shop:",
    goShop: "Go to the shop",
  },
  uz: {
    subject: (a, n) => `${a} sovg‘a sertifikati — №${n} buyurtma`,
    hello: "Assalomu alaykum!",
    intro: (s, a) => [`Xaridingiz uchun rahmat. «${s}» do‘konining sovg‘a sertifikati: `, a],
    howTo: "Kodni buyurtma rasmiylashtirishda «Sovg‘a sertifikati» maydoniga kiriting.",
    shop: "Do‘kon:",
    goShop: "Do‘konga o‘tish",
  },
};

/**
 * Код подарочного сертификата, купленного на сайте (core/discounts/gift-mail):
 * код, номинал и где им оплатить, на языке магазина. Та же страница заказа
 * хранит код, письмо — копия, чтобы подарок было удобно переслать.
 */
export function giftCodeMail(p: {
  orderNo: number | string;
  shopName: string;
  code: string;
  amount: string;
  shopUrl: string | null;
  locale?: Locale;
}): { subject: string; text: string; html: string } {
  const t = GIFT_MAIL[p.locale ?? "ru"] ?? GIFT_MAIL.ru;
  const subject = t.subject(p.amount, p.orderNo);
  const [intro, amount] = t.intro(p.shopName, p.amount);
  const text = [
    t.hello,
    "",
    `${intro}${amount}:`,
    "",
    p.code,
    "",
    t.howTo,
    ...(p.shopUrl ? [t.shop, p.shopUrl] : []),
    "",
    p.shopName,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
<p>${esc(t.hello)}</p>
<p>${esc(intro)}<strong>${esc(amount)}</strong>:</p>
<p style="font-size:22px;font-family:ui-monospace,Menlo,monospace;letter-spacing:1px"><strong>${esc(p.code)}</strong></p>
<p>${esc(t.howTo)}</p>
${p.shopUrl ? `<p><a href="${esc(p.shopUrl)}" style="color:#0b57d0">${esc(t.goShop)}</a></p>` : ""}
<p>${esc(p.shopName)}</p>
</div>`;
  return { subject, text, html };
}

/** Текст уведомления из мессенджера — в письмо: без HTML-разметки Telegram. */
export function plainNotice(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Письмо покупателю с сайта о его заказе (статус, отказ, напоминание) — то
 * же, что покупатель из бота получает сообщением, и ссылка на страницу заказа.
 */
export function orderNoticeMail(p: {
  orderNo: number | string;
  shopName: string;
  notice: string;
  url: string;
}): { subject: string; text: string; html: string } {
  const notice = plainNotice(p.notice);
  // Название магазина задаёт продавец: переводы строк в теме письма не пропускаем.
  const subject = `Заказ №${p.orderNo} в магазине «${p.shopName}»`.replace(/[\r\n]+/g, " ");
  const text = ["Здравствуйте!", "", notice, "", "Страница заказа:", p.url, "", p.shopName].join(
    "\n",
  );
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
<p>Здравствуйте!</p>
<p>${esc(notice).replace(/\n/g, "<br>")}</p>
<p><a href="${esc(p.url)}" style="color:#0b57d0">Открыть заказ</a></p>
<p>${esc(p.shopName)}</p>
</div>`;
  return { subject, text, html };
}
