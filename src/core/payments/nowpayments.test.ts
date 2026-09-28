import { describe, expect, it } from "vitest";
import {
  createInvoice,
  ipnOutcome,
  ipnSignature,
  nowpaymentsConfig,
  sortedJson,
  verifyIpn,
} from "./nowpayments";

describe("NOWPayments", () => {
  it("настройка готова только с модулем, тумблером, ключом и секретом", () => {
    const s = { crypto_enabled: "true", nowpayments_api_key: "k", nowpayments_ipn_secret: "s" };
    expect(nowpaymentsConfig(s, true)).toEqual({ ready: true, apiKey: "k", ipnSecret: "s" });
    expect(nowpaymentsConfig(s, false).ready).toBe(false);
    expect(nowpaymentsConfig({ ...s, crypto_enabled: "false" }, true).ready).toBe(false);
    expect(nowpaymentsConfig({ ...s, nowpayments_ipn_secret: " " }, true).ready).toBe(false);
  });

  it("подпись IPN — HMAC-SHA512 по JSON с ключами по алфавиту на всех уровнях", () => {
    expect(sortedJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
    const body = { payment_status: "finished", order_id: "5", price_amount: 100 };
    const sig = ipnSignature(body, "secret");
    // Порядок ключей в теле запроса не важен — важна подпись по отсортированным.
    const raw = JSON.stringify({ price_amount: 100, order_id: "5", payment_status: "finished" });
    expect(verifyIpn(raw, sig, "secret")).toBe(true);
    expect(verifyIpn(raw, sig.toUpperCase(), "secret")).toBe(true);
    expect(verifyIpn(raw, sig, "other")).toBe(false);
    expect(verifyIpn(raw, null, "secret")).toBe(false);
    expect(verifyIpn("не json", sig, "secret")).toBe(false);
  });

  it("исход: оплачено только finished с суммой и валютой заказа", () => {
    const exp = { amount: 12000, currency: "KZT" };
    const ipn = { payment_status: "finished", price_amount: "12000", price_currency: "kzt" };
    expect(ipnOutcome(ipn, exp)).toBe("paid");
    expect(ipnOutcome({ ...ipn, payment_status: "confirmed" }, exp)).toBe("pending");
    expect(ipnOutcome({ ...ipn, payment_status: "partially_paid" }, exp)).toBe("partial");
    expect(ipnOutcome({ ...ipn, payment_status: "expired" }, exp)).toBe("failed");
    expect(ipnOutcome({ ...ipn, price_amount: 1 }, exp)).toBe("mismatch");
    expect(ipnOutcome({ ...ipn, price_currency: "usd" }, exp)).toBe("mismatch");
  });

  it("счёт: сумма в валюте заказа, id заказа строкой, ссылка из ответа", async () => {
    let sent: Record<string, unknown> = {};
    const ok = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 77, invoice_url: "https://nowpayments.io/p/77" }));
    }) as unknown as typeof fetch;
    const p = {
      amount: 12000.004,
      currency: "KZT",
      orderId: 5,
      description: "Заказ #5",
      ipnUrl: "https://x/api/nowpayments/b",
      successUrl: "https://t.me/shop",
      cancelUrl: "https://t.me/shop",
    };
    expect(await createInvoice({ apiKey: "k", ipnSecret: "s" }, p, ok)).toEqual({
      ok: true,
      url: "https://nowpayments.io/p/77",
      id: "77",
    });
    expect(sent).toMatchObject({ price_amount: 12000, price_currency: "kzt", order_id: "5" });
    const bad = (async () =>
      new Response(JSON.stringify({ message: "Currency kzt is not supported" }), {
        status: 400,
      })) as unknown as typeof fetch;
    expect(await createInvoice({ apiKey: "k", ipnSecret: "s" }, p, bad)).toEqual({
      ok: false,
      error: "Currency kzt is not supported",
    });
  });
});
