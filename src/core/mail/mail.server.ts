import nodemailer from "nodemailer";
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
    });
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
