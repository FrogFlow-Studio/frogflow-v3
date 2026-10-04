import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * «Авторы приглашают авторов». Ссылка `/signup?invite=<магазин>.<подпись>`:
 * подпись — HMAC платформенного секрета по id пригласившего, поэтому ссылку
 * нельзя составить на чужой магазин по одному id. Новичок получает скидку на
 * подключение (в счёте по плану), пригласивший — месяц подписки в зачёт, но
 * только после того, как новичок реально оплатил тариф. Деньги не списываем:
 * зачёт делает оператор одной кнопкой (app/operator/invites.server), в журнале
 * оплат остаётся платёж на 0 ₸ с номером платежа новичка. Секрет передаёт
 * вызывающий (ядро не читает окружение).
 */
/** Скидка новичку на подключение, %. */
export const INVITE_DISCOUNT_PERCENT = 20;
/** Пометка зачётных платежей в `subscription_payments.note`: по ней их не считают оплатой тарифа. */
export const INVITE_NOTE_PREFIX = "Зачёт за приглашение";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LEN = 22;

const sign = (secret: string, botId: string) =>
  createHmac("sha256", secret).update(`invite:${botId}`).digest("base64url").slice(0, SIG_LEN);

export function inviteToken(secret: string, botId: string): string {
  const id = botId.toLowerCase();
  return `${id}.${sign(secret, id)}`;
}

/** Магазин-пригласивший из токена ссылки; подделка или мусор — null. */
export function parseInviteToken(secret: string, token: string | null | undefined): string | null {
  const t = (token ?? "").trim();
  const dot = t.indexOf(".");
  if (dot !== 36) return null;
  const id = t.slice(0, 36).toLowerCase();
  const got = Buffer.from(t.slice(37));
  const want = Buffer.from(sign(secret, id));
  if (!UUID.test(id) || got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return id;
}

/** Скидка на подключение в тенге, целая; null — скидки нет. */
export function connectionDiscount(connection: number, percent = INVITE_DISCOUNT_PERCENT): number {
  return Math.round((connection * percent) / 100);
}

export type InviteSide = { id: string; ownerTelegramId: number | null; contact: string | null };

/** Контакт для сравнения: только цифры телефона или адрес почты в нижнем регистре. */
function sameContact(a: string | null, b: string | null): boolean {
  const norm = (v: string | null) => {
    const s = (v ?? "").trim().toLowerCase();
    if (!s) return "";
    return s.includes("@") ? s : s.replace(/\D/g, "");
  };
  const x = norm(a);
  const y = norm(b);
  return x.length >= 5 && x === y;
}

export type CreditCheck =
  | { ok: true; paymentId: string; amount: number }
  | { ok: false; reason: "no_invite" | "already" | "self" | "not_paid" };

/** Платёж подписки новичка: достаточно полей для решения. */
export type InviteePayment = { id: string; amount: number; note: string | null };

/**
 * Можно ли зачесть месяц пригласившему. Оплатой тарифа считается платёж на
 * сумму больше нуля, не зачётный. Платёж, который оператор удалил (оплата
 * отменена), в списке уже нет — и зачёт не выдаётся.
 */
export function creditCheck(input: {
  invite: { by: string; reward?: unknown } | undefined;
  inviter: InviteSide;
  invitee: InviteSide;
  payments: InviteePayment[];
}): CreditCheck {
  const { invite, inviter, invitee } = input;
  if (!invite || invite.by.toLowerCase() !== inviter.id.toLowerCase())
    return { ok: false, reason: "no_invite" };
  if (invite.reward) return { ok: false, reason: "already" };
  if (
    inviter.id === invitee.id ||
    (inviter.ownerTelegramId != null && inviter.ownerTelegramId === invitee.ownerTelegramId) ||
    sameContact(inviter.contact, invitee.contact)
  )
    return { ok: false, reason: "self" };
  const paid = input.payments
    .filter((p) => p.amount > 0 && !(p.note ?? "").startsWith(INVITE_NOTE_PREFIX))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!paid) return { ok: false, reason: "not_paid" };
  return { ok: true, paymentId: paid.id, amount: paid.amount };
}
