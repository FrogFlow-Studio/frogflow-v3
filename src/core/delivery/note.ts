/**
 * Приписка продавца к сообщению о выдаче в Instagram Direct и WhatsApp.
 * Первая часть — факт выдачи от платформы (номер заказа); её продавец не
 * правит. Последний абзац — правило его магазина: «повторная отправка
 * платная», «если письма нет — проверьте „Спам“». Так было в v1
 * (tests/delivery-message.test.ts в описи): просьба одной продавщицы не
 * навязывается остальным, поэтому текст — в настройках магазина.
 *
 * Ключ тот же, что в v1 (app_settings.delivery_email_note): у переехавшего
 * клиента приписка продолжает работать без переноса.
 */
export const DELIVERY_NOTE_KEY = "delivery_email_note";
export const DELIVERY_NOTE_MAX = 1000;

/** Приписка, когда продавец свою не задал, — дословно как в v1 (DEFAULT_DELIVERY_NOTE). */
export const DEFAULT_DELIVERY_NOTE =
  "Если письма нет — проверьте папку «Спам» и напишите сюда, поможем.";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Сообщение о выдаче с припиской последним абзацем. Сообщения каналов —
 * HTML (каналы снимают разметку сами), поэтому текст продавца экранируется:
 * «<3» или «a < b» доходят как написаны. Пустая приписка — текст по
 * умолчанию про «Спам», как в v1.
 */
export function withSellerNote(deliveredHtml: string, note: string | null | undefined): string {
  const n = (note ?? "").trim().slice(0, DELIVERY_NOTE_MAX) || DEFAULT_DELIVERY_NOTE;
  return `${deliveredHtml}\n\n${escapeHtml(n)}`;
}
