import { describe, expect, it, vi } from "vitest";
import {
  createKaspiLink,
  kaspiApipayConfig,
  kaspiOutcome,
  parseKaspiOrderRef,
  parseKaspiWebhook,
  verifyKaspiSignature,
} from "./kaspi-apipay";
import { createHmac } from "node:crypto";

const on = {
  kaspi_apipay_enabled: "true",
  kaspi_apipay_api_key: " key ",
  kaspi_apipay_webhook_secret: "sec",
};

describe("настройки Kaspi (ApiPay)", () => {
  it("готов только с модулем, галочкой, ключом и секретом", () => {
    expect(kaspiApipayConfig(on, true)).toEqual({
      ready: true,
      apiKey: "key",
      webhookSecret: "sec",
      testMode: false,
    });
    expect(kaspiApipayConfig(on, false).ready).toBe(false);
    expect(kaspiApipayConfig({ ...on, kaspi_apipay_enabled: "false" }, true).ready).toBe(false);
    expect(kaspiApipayConfig({ ...on, kaspi_apipay_api_key: "" }, true).ready).toBe(false);
    expect(kaspiApipayConfig({ ...on, kaspi_apipay_webhook_secret: " " }, true).ready).toBe(false);
  });
});

describe("номер заказа в ApiPay", () => {
  it("только наш префикс и целый номер", () => {
    expect(parseKaspiOrderRef("ff-ord:42")).toBe(42);
    expect(parseKaspiOrderRef("ff-inv:42")).toBeNull();
    expect(parseKaspiOrderRef("ff-ord:0")).toBeNull();
    expect(parseKaspiOrderRef("ff-ord:4x")).toBeNull();
    expect(parseKaspiOrderRef(42)).toBeNull();
  });
});

describe("ссылка на оплату", () => {
  it("одноразовая ссылка на сумму заказа с ключом идемпотентности заказ+сумма", async () => {
    const fetchImpl = vi.fn(
      async (_u: string, _i: RequestInit) =>
        new Response(JSON.stringify({ payment_url: "https://pay.apipay.kz/x", static_qr_id: 7 }), {
          status: 201,
        }),
    );
    const r = await createKaspiLink(
      { apiKey: "key" },
      { orderId: 42, amount: 4500, description: "Заказ #7" },
      fetchImpl,
    );
    expect(r).toEqual({ ok: true, url: "https://pay.apipay.kz/x", id: "7" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.apipay.kz/api/v1/invoices/qr");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("key");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(String(init.body))).toMatchObject({
      single_use: true,
      amount: 4500,
      external_order_id: "ff-ord:42",
      external_order_id_idempotency: "ff-ord:42:4500",
    });
  });

  it("повтор — 409 idempotency_conflict с той же ссылкой", async () => {
    const r = await createKaspiLink(
      { apiKey: "k" },
      { orderId: 1, amount: 1, description: "x" },
      async () =>
        new Response(
          JSON.stringify({
            error_code: "idempotency_conflict",
            payment_url: "https://pay.apipay.kz/y",
          }),
          { status: 409 },
        ),
    );
    expect(r).toMatchObject({ ok: true, url: "https://pay.apipay.kz/y" });
  });

  it("отказ, обрыв и не-https ссылка — ошибка без ссылки", async () => {
    const deny = await createKaspiLink(
      { apiKey: "k" },
      { orderId: 1, amount: 1, description: "x" },
      async () =>
        new Response(JSON.stringify({ error_code: "cashier_unavailable" }), { status: 422 }),
    );
    expect(deny).toEqual({ ok: false, error: "ApiPay ответил 422 (cashier_unavailable)" });
    const down = await createKaspiLink(
      { apiKey: "k" },
      { orderId: 1, amount: 1, description: "x" },
      async () => {
        throw new Error("timeout");
      },
    );
    expect(down.ok).toBe(false);
    const http = await createKaspiLink(
      { apiKey: "k" },
      { orderId: 1, amount: 1, description: "x" },
      async () =>
        new Response(JSON.stringify({ payment_url: "http://pay.apipay.kz/z" }), { status: 201 }),
    );
    expect(http.ok).toBe(false);
  });
});

describe("вебхук", () => {
  it("подпись sha256= по сырому телу", () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`;
    expect(verifyKaspiSignature(body, sig, "s")).toBe(true);
    expect(verifyKaspiSignature(body, sig.toUpperCase().replace("SHA256=", "sha256="), "s")).toBe(
      true,
    );
    expect(verifyKaspiSignature(body, sig, "other")).toBe(false);
    expect(verifyKaspiSignature(body, null, "s")).toBe(false);
  });

  it("оплата, возврат и пропуски", () => {
    const inv = { id: 5, status: "paid", amount: "10", external_order_id: "ff-ord:3" };
    expect(parseKaspiWebhook({ event: "invoice.status_changed", invoice: inv })).toEqual({
      kind: "paid",
      apipayId: "5",
      orderId: 3,
      amount: 10,
      sandbox: null,
    });
    expect(
      parseKaspiWebhook({
        event: "invoice.refunded",
        invoice: { ...inv, is_fully_refunded: true },
      }),
    ).toEqual({ kind: "refunded", apipayId: "5", orderId: 3, full: true });
    expect(parseKaspiWebhook({ event: "invoice.qr_scanned", invoice: inv }).kind).toBe("ignored");
    expect(
      parseKaspiWebhook({ event: "invoice.status_changed", invoice: { ...inv, status: "expired" } })
        .kind,
    ).toBe("ignored");
  });

  it("песочная оплата — только в тестовом режиме; сумма — ровно к оплате в тенге", () => {
    const ev = { kind: "paid" as const, apipayId: "1", orderId: 1, amount: 100, sandbox: false };
    const kzt = { amount: 100, currency: "KZT" };
    expect(kaspiOutcome(ev, { testMode: false }, kzt)).toBe("paid");
    expect(kaspiOutcome({ ...ev, sandbox: true }, { testMode: false }, kzt)).toBe("sandbox");
    expect(kaspiOutcome({ ...ev, sandbox: null }, { testMode: false }, kzt)).toBe("sandbox");
    expect(kaspiOutcome({ ...ev, sandbox: true }, { testMode: true }, kzt)).toBe("paid");
    expect(kaspiOutcome({ ...ev, amount: 99 }, { testMode: false }, kzt)).toBe("mismatch");
    expect(kaspiOutcome(ev, { testMode: false }, { amount: 100, currency: "RUB" })).toBe(
      "mismatch",
    );
  });
});
