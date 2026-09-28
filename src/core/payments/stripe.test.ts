import { describe, expect, it, vi } from "vitest";
import {
  createCheckoutSession,
  sessionOrderId,
  stripeConfig,
  stripeOutcome,
  stripeSignature,
  toMinor,
  verifyStripeSignature,
} from "./stripe";

const session = (over: Record<string, unknown> = {}) => ({
  type: "checkout.session.completed",
  data: {
    object: {
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 1_200_000,
      currency: "kzt",
      client_reference_id: "42",
      ...over,
    },
  },
});

describe("Stripe", () => {
  it("настройка готова только с модулем, тумблером, ключом и секретом вебхука", () => {
    const s = { stripe_enabled: "true", stripe_secret_key: "sk", stripe_webhook_secret: "wh" };
    expect(stripeConfig(s, true)).toEqual({ ready: true, secretKey: "sk", webhookSecret: "wh" });
    expect(stripeConfig(s, false).ready).toBe(false);
    expect(stripeConfig({ ...s, stripe_enabled: "false" }, true).ready).toBe(false);
    expect(stripeConfig({ ...s, stripe_webhook_secret: " " }, true).ready).toBe(false);
  });

  it("сумма в минимальных единицах: копейки, а у валют без копеек — целые", () => {
    expect(toMinor(12000, "KZT")).toBe(1_200_000);
    expect(toMinor(19.99, "usd")).toBe(1999);
    expect(toMinor(1500, "JPY")).toBe(1500);
    // Трёхзнаковые: 10 KWD — 10 000 филсов, а не 1 000.
    expect(toMinor(10, "KWD")).toBe(10_000);
    expect(toMinor(1.234, "BHD")).toBe(1_230);
  });

  it("подпись: HMAC-SHA256 по «t.тело», свежая, любой из v1", () => {
    const raw = JSON.stringify(session());
    const now = 1_700_000_000;
    const sig = stripeSignature(raw, now, "whsec");
    expect(verifyStripeSignature(raw, `t=${now},v1=${sig}`, "whsec", now)).toBe(true);
    expect(verifyStripeSignature(raw, `t=${now},v1=deadbeef,v1=${sig}`, "whsec", now)).toBe(true);
    expect(verifyStripeSignature(raw, `t=${now},v1=${sig}`, "other", now)).toBe(false);
    expect(verifyStripeSignature(`${raw} `, `t=${now},v1=${sig}`, "whsec", now)).toBe(false);
    // Старое событие — повтор перехваченного запроса.
    expect(verifyStripeSignature(raw, `t=${now},v1=${sig}`, "whsec", now + 301)).toBe(false);
    expect(verifyStripeSignature(raw, null, "whsec", now)).toBe(false);
    expect(verifyStripeSignature(raw, `v1=${sig}`, "whsec", now)).toBe(false);
  });

  it("исход: оплачено только paid с суммой и валютой заказа", () => {
    const exp = { amount: 12000, currency: "KZT" };
    expect(stripeOutcome(session(), exp)).toBe("paid");
    expect(
      stripeOutcome({ ...session(), type: "checkout.session.async_payment_succeeded" }, exp),
    ).toBe("paid");
    expect(stripeOutcome(session({ payment_status: "unpaid" }), exp)).toBe("pending");
    expect(stripeOutcome(session({ amount_total: 100 }), exp)).toBe("mismatch");
    expect(stripeOutcome(session({ currency: "usd" }), exp)).toBe("mismatch");
    expect(
      stripeOutcome({ ...session(), type: "checkout.session.async_payment_failed" }, exp),
    ).toBe("failed");
    expect(stripeOutcome({ ...session(), type: "charge.succeeded" }, exp)).toBe("ignore");
    expect(stripeOutcome(session({ object: "payment_intent" }), exp)).toBe("ignore");
  });

  it("номер заказа — из client_reference_id или metadata", () => {
    expect(sessionOrderId(session())).toBe(42);
    expect(
      sessionOrderId(session({ client_reference_id: null, metadata: { order_id: "7" } })),
    ).toBe(7);
    expect(sessionOrderId(session({ client_reference_id: "x" }))).toBeNull();
  });

  it("сессия Checkout: форма с суммой в копейках, ключ в заголовке", async () => {
    const f = vi.fn(async () =>
      Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }),
    );
    const r = await createCheckoutSession(
      { secretKey: "sk_test", webhookSecret: "wh" },
      {
        amount: 12000,
        currency: "KZT",
        orderId: 42,
        botId: "b",
        description: "Заказ #42",
        successUrl: "https://a/ok",
        cancelUrl: "https://a/no",
        email: "a@b.c",
      },
      f as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: true, url: "https://checkout.stripe.com/c/cs_1", id: "cs_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1200000");
    expect(body.get("line_items[0][price_data][currency]")).toBe("kzt");
    expect(body.get("client_reference_id")).toBe("42");
    expect(body.get("customer_email")).toBe("a@b.c");
  });

  it("ошибка Stripe возвращается текстом, без исключения", async () => {
    const f = vi.fn(async () =>
      Response.json({ error: { message: "Invalid API Key" } }, { status: 401 }),
    );
    const r = await createCheckoutSession(
      { secretKey: "bad", webhookSecret: "wh" },
      {
        amount: 1,
        currency: "usd",
        orderId: 1,
        botId: "b",
        description: "x",
        successUrl: "https://a",
        cancelUrl: "https://a",
      },
      f as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: false, error: "Invalid API Key" });
  });
});
