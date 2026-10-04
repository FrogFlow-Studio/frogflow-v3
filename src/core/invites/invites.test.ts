import { describe, expect, it } from "vitest";
import {
  INVITE_DISCOUNT_PERCENT,
  INVITE_NOTE_PREFIX,
  connectionDiscount,
  creditCheck,
  inviteToken,
  parseInviteToken,
  type InviteSide,
} from "./invites";

const SECRET = "test-secret-test-secret-test-secret";
const A = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const B = "0bac1f86-5231-4e57-838d-2faa44d427e7";

describe("ссылка-приглашение", () => {
  it("токен разбирается в магазин пригласившего", () => {
    expect(parseInviteToken(SECRET, inviteToken(SECRET, A))).toBe(A);
    expect(parseInviteToken(SECRET, inviteToken(SECRET, A.toUpperCase()))).toBe(A);
  });

  it("подделать токен на чужой магазин или другим секретом нельзя", () => {
    const sig = inviteToken(SECRET, A).slice(37);
    expect(parseInviteToken(SECRET, `${B}.${sig}`)).toBeNull();
    expect(parseInviteToken("другой-секрет", inviteToken(SECRET, A))).toBeNull();
    for (const bad of [null, undefined, "", A, `${A}.`, `${A}.xxxx`, "не-токен"])
      expect(parseInviteToken(SECRET, bad)).toBeNull();
  });

  it("скидка на подключение — доля из константы, целая", () => {
    expect(connectionDiscount(15_000)).toBe(Math.round((15_000 * INVITE_DISCOUNT_PERCENT) / 100));
    expect(connectionDiscount(15_000, 10)).toBe(1500);
  });
});

describe("зачёт пригласившему", () => {
  const inviter: InviteSide = { id: A, ownerTelegramId: 100, contact: "+7 700 111 22 33" };
  const invitee: InviteSide = { id: B, ownerTelegramId: 200, contact: "+7 701 999 88 77" };
  const pay = (id: string, amount: number, note: string | null = null) => ({ id, amount, note });
  const base = { invite: { by: A }, inviter, invitee, payments: [pay("p1", 9900)] };

  it("новичок оплатил тариф — зачёт можно, платёж назван", () => {
    expect(creditCheck(base)).toEqual({ ok: true, paymentId: "p1", amount: 9900 });
  });

  it("нет оплаты: платежей нет, платёж на 0 или зачётный не считаются; удалённый платёж = нет платежа", () => {
    for (const payments of [[], [pay("p1", 0)], [pay("p1", 5000, `${INVITE_NOTE_PREFIX} «Х»`)]])
      expect(creditCheck({ ...base, payments })).toEqual({ ok: false, reason: "not_paid" });
  });

  it("уже зачтено — второй раз нельзя", () => {
    expect(creditCheck({ ...base, invite: { by: A, reward: { at: "x" } } })).toEqual({
      ok: false,
      reason: "already",
    });
  });

  it("сам себя пригласить нельзя: тот же Telegram, телефон или почта", () => {
    const same = (patch: Partial<typeof invitee>) =>
      creditCheck({ ...base, invitee: { ...invitee, ...patch } });
    expect(same({ ownerTelegramId: 100 })).toEqual({ ok: false, reason: "self" });
    expect(same({ contact: "87001112233".replace(/^8/, "+7") })).toEqual({
      ok: false,
      reason: "self",
    });
    expect(same({ id: A })).toEqual({ ok: false, reason: "self" });
    const mail = { ...inviter, contact: "Owner@Mail.kz" };
    expect(
      creditCheck({ ...base, inviter: mail, invitee: { ...invitee, contact: "owner@mail.kz" } }),
    ).toEqual({ ok: false, reason: "self" });
    // Пустые контакты не совпадают сами с собой.
    expect(same({ contact: null, ownerTelegramId: null })).toMatchObject({ ok: true });
  });

  it("приглашение другого магазина или его нет — зачёта нет", () => {
    expect(creditCheck({ ...base, invite: { by: B } })).toEqual({ ok: false, reason: "no_invite" });
    expect(creditCheck({ ...base, invite: undefined })).toEqual({ ok: false, reason: "no_invite" });
  });
});
