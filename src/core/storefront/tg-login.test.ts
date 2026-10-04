import { describe, expect, it } from "vitest";
import {
  BUYER_SESSION_SEC,
  botTokenStamp,
  buyerCookieName,
  signBuyerSession,
  signLoginWidget,
  validateLoginWidget,
  verifyBuyerSession,
} from "./tg-login";

const TOKEN = "123456:shop-a-token";
const OTHER_TOKEN = "654321:shop-b-token";
const NOW = 1_790_000_000;
const SECRET = "server-secret-32-bytes-long-xxxxxxx";
const SHOP = "11111111-2222-3333-4444-555555555555";
const OTHER_SHOP = "99999999-2222-3333-4444-555555555555";

function widget(fields: Record<string, string>, token = TOKEN) {
  return { ...fields, hash: signLoginWidget(fields, token) };
}
const base = { id: "42", first_name: "Анна", username: "anna", auth_date: String(NOW - 60) };

describe("вход через Telegram: подпись виджета", () => {
  it("данные, подписанные ботом этого магазина, принимаются", () => {
    const r = validateLoginWidget(widget(base), TOKEN, undefined, NOW);
    expect(r).toEqual({
      ok: true,
      authDate: NOW - 60,
      user: { id: 42, first_name: "Анна", last_name: undefined, username: "anna" },
    });
  });

  it("подпись бота другого магазина не подходит", () => {
    expect(validateLoginWidget(widget(base, OTHER_TOKEN), TOKEN, undefined, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("подменённое поле ломает подпись", () => {
    const w = widget(base);
    expect(validateLoginWidget({ ...w, id: "43" }, TOKEN, undefined, NOW).ok).toBe(false);
    expect(validateLoginWidget({ ...w, extra: "1" }, TOKEN, undefined, NOW).ok).toBe(false);
    expect(validateLoginWidget({ ...w, hash: "" }, TOKEN, undefined, NOW).ok).toBe(false);
    expect(validateLoginWidget({ ...w, hash: "zz" }, TOKEN, undefined, NOW).ok).toBe(false);
    const { hash: _h, ...noHash } = w;
    expect(validateLoginWidget(noHash, TOKEN, undefined, NOW).ok).toBe(false);
  });

  it("новые поля Telegram входят в подпись и не мешают", () => {
    const w = widget({ ...base, photo_url: "https://t.me/i/userpic/1.jpg" });
    expect(validateLoginWidget(w, TOKEN, undefined, NOW).ok).toBe(true);
  });

  it("вход старше суток или из будущего — просрочен", () => {
    const old = widget({ ...base, auth_date: String(NOW - 25 * 3600) });
    expect(validateLoginWidget(old, TOKEN, undefined, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
    const future = widget({ ...base, auth_date: String(NOW + 3600) });
    expect(validateLoginWidget(future, TOKEN, undefined, NOW).ok).toBe(false);
  });

  it("без id покупателя — отказ", () => {
    const { id: _id, ...rest } = base;
    expect(validateLoginWidget(widget(rest), TOKEN, undefined, NOW)).toEqual({
      ok: false,
      reason: "no_user",
    });
  });
});

describe("вход через Telegram: cookie покупателя", () => {
  const stamp = botTokenStamp(TOKEN);

  it("своя cookie читается в своём магазине до конца срока", () => {
    const v = signBuyerSession(SECRET, SHOP, stamp, 42, NOW);
    expect(verifyBuyerSession(SECRET, SHOP, stamp, v, NOW + 10)).toBe(42);
    expect(verifyBuyerSession(SECRET, SHOP, stamp, v, NOW + BUYER_SESSION_SEC + 1)).toBeNull();
  });

  it("покупатель Instagram/WhatsApp (отрицательный id) входит по коду; нулевой id и подделка — нет", () => {
    const v = signBuyerSession(SECRET, SHOP, stamp, -77, NOW);
    expect(verifyBuyerSession(SECRET, SHOP, stamp, v, NOW + 10)).toBe(-77);
    expect(verifyBuyerSession(SECRET, SHOP, stamp, v.replace("-77", "-78"), NOW + 10)).toBeNull();
    expect(
      verifyBuyerSession(SECRET, SHOP, stamp, signBuyerSession(SECRET, SHOP, stamp, 0, NOW), NOW),
    ).toBeNull();
  });

  it("в другом магазине не действует", () => {
    const v = signBuyerSession(SECRET, SHOP, stamp, 42, NOW);
    expect(verifyBuyerSession(SECRET, OTHER_SHOP, stamp, v, NOW)).toBeNull();
    expect(buyerCookieName(SHOP)).not.toBe(buyerCookieName(OTHER_SHOP));
    expect(buyerCookieName(SHOP)).toMatch(/^ff_tg_[0-9a-f]{32}$/);
  });

  it("продавец сменил токен бота — прежние входы не действуют", () => {
    const v = signBuyerSession(SECRET, SHOP, stamp, 42, NOW);
    expect(verifyBuyerSession(SECRET, SHOP, botTokenStamp(OTHER_TOKEN), v, NOW)).toBeNull();
    expect(stamp).not.toContain(TOKEN);
  });

  it("подделка id, срока или подписи не проходит", () => {
    const v = signBuyerSession(SECRET, SHOP, stamp, 42, NOW);
    const [, exp, mac] = v.split(".");
    expect(verifyBuyerSession(SECRET, SHOP, stamp, `43.${exp}.${mac}`, NOW)).toBeNull();
    expect(
      verifyBuyerSession(SECRET, SHOP, stamp, `42.${Number(exp) + 99}.${mac}`, NOW),
    ).toBeNull();
    expect(verifyBuyerSession("other-secret", SHOP, stamp, v, NOW)).toBeNull();
    for (const bad of ["", "42", "42.1.x", `-1.${exp}.${mac}`, `0.${exp}.${mac}`, null])
      expect(verifyBuyerSession(SECRET, SHOP, stamp, bad, NOW)).toBeNull();
  });
});
