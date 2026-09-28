import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  apipayOrderId,
  apipayProvider,
  parseApipayOrderId,
  parseApipayWebhook,
  verifyApipaySignature,
  type ApipayConfig,
} from "./apipay";
import { availableProviders, issueWithFallback, type IssueRequest } from "./provider";
import { transferProvider } from "./transfer";

const INV = "0b9f6d3e-1c2a-4b5c-8d7e-9f0a1b2c3d4e";
const BOT = "11111111-2222-4333-8444-555555555555";
const req: IssueRequest = {
  invoiceId: INV,
  botId: BOT,
  amount: 9900,
  currency: "KZT",
  note: "План Basic на месяц",
  requisites: "Kaspi Gold 4400 …",
  ownerPhone: null,
};
const live: ApipayConfig = {
  apiKey: "key-1",
  baseUrl: "https://api.apipay.test/api/v1",
  live: true,
  sandboxBotId: null,
};

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { f, calls };
}

describe("ApiPay: ссылка на оплату счёта", () => {
  it("создаёт одноразовую ссылку на сумму счёта с нашим номером заказа", async () => {
    const { f, calls } = fakeFetch(201, {
      static: true,
      static_qr_id: 77,
      payment_url: "https://pay.apipay.kz/l/abc",
      status: "active",
    });
    const issued = await apipayProvider(live, f).issue(req);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.apipay.test/api/v1/invoices/qr");
    expect((calls[0]!.init.headers as Record<string, string>)["X-API-Key"]).toBe("key-1");
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({
      static: true,
      single_use: true,
      amount: 9900,
      description: "План Basic на месяц",
      external_order_id: `ff-inv:${INV}`,
      external_order_id_idempotency: INV,
    });
    expect(issued).toMatchObject({
      provider: "apipay",
      externalId: "77",
      payUrl: "https://pay.apipay.kz/l/abc",
    });
    expect(issued.ownerText).toContain("9900 KZT");
    expect(issued.ownerText).toContain("https://pay.apipay.kz/l/abc");
  });

  it("повтор того же счёта берёт уже созданную ссылку из 409", async () => {
    const { f } = fakeFetch(409, {
      error_code: "idempotency_conflict",
      static_qr_id: 77,
      payment_url: "https://pay.apipay.kz/l/abc",
    });
    expect((await apipayProvider(live, f).issue(req)).payUrl).toBe("https://pay.apipay.kz/l/abc");
  });

  it("описание длиннее 60 символов обрезается — Kaspi показывает только 60", async () => {
    const { f, calls } = fakeFetch(201, { payment_url: "https://pay.apipay.kz/l/x" });
    await apipayProvider(live, f).issue({ ...req, note: "я".repeat(80) });
    expect(JSON.parse(String(calls[0]!.init.body)).description).toHaveLength(60);
  });

  it("отказ ApiPay не выдаёт ключ и уводит счёт на запасной способ", async () => {
    const { f } = fakeFetch(401, { error: "unauthenticated" });
    const { issued, skipped } = await issueWithFallback(
      [apipayProvider(live, f), transferProvider],
      req,
    );
    expect(issued.provider).toBe("transfer");
    expect(skipped[0]?.provider).toBe("apipay");
    expect(skipped[0]?.reason).toContain("401");
    expect(skipped[0]?.reason).not.toContain("key-1");
  });

  it("ответ без https-ссылки — ошибка, а не пустая ссылка владельцу", async () => {
    const { f } = fakeFetch(201, { payment_url: "javascript:alert(1)" });
    await expect(apipayProvider(live, f).issue(req)).rejects.toThrow("ссылку");
  });

  it("сеть упала — понятная ошибка", async () => {
    const f = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(apipayProvider(live, f).issue(req)).rejects.toThrow("ApiPay недоступен");
  });

  it("без ключа, не в тенге и в песочнице для чужого магазина — пропускается", async () => {
    const { f } = fakeFetch(201, {});
    expect(await apipayProvider(null, f).unavailable(req)).toContain("не настроен");
    expect(await apipayProvider(live, f).unavailable({ ...req, currency: "USD" })).toContain(
      "тенге",
    );
    const sandbox = { ...live, live: false, sandboxBotId: "другой" };
    expect(await apipayProvider(sandbox, f).unavailable(req)).toContain("песочниц");
    expect(await apipayProvider({ ...sandbox, sandboxBotId: BOT }, f).unavailable(req)).toBeNull();
    const { ready, skipped } = await availableProviders(
      [apipayProvider(null, f), transferProvider],
      req,
    );
    expect(ready.map((p) => p.key)).toEqual(["transfer"]);
    expect(skipped[0]?.provider).toBe("apipay");
  });
});

describe("ApiPay: вебхук", () => {
  const secret = "whsec_test";
  const sign = (raw: string) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  it("проверяет подпись по сырому телу", () => {
    const raw = JSON.stringify({ event: "invoice.status_changed" });
    expect(verifyApipaySignature(raw, sign(raw), secret)).toBe(true);
    expect(verifyApipaySignature(raw + " ", sign(raw), secret)).toBe(false);
    expect(verifyApipaySignature(raw, sign(raw), "другой")).toBe(false);
    expect(verifyApipaySignature(raw, null, secret)).toBe(false);
    expect(verifyApipaySignature(raw, sign(raw), undefined)).toBe(false);
    expect(verifyApipaySignature(raw, "sha256=00", secret)).toBe(false);
    // Байты тела как пришли и hex в любом регистре.
    expect(verifyApipaySignature(Buffer.from(raw), sign(raw), secret)).toBe(true);
    expect(
      verifyApipaySignature(raw, sign(raw).toUpperCase().replace("SHA256=", "sha256="), secret),
    ).toBe(true);
  });

  it("номер заказа — только наш префикс и uuid", () => {
    expect(parseApipayOrderId(apipayOrderId(INV))).toBe(INV);
    expect(parseApipayOrderId("order_123")).toBeNull();
    expect(parseApipayOrderId("ff-inv:1 or 1=1")).toBeNull();
    expect(parseApipayOrderId(null)).toBeNull();
  });

  it("оплата нашего счёта разбирается, остальное пропускается с причиной", () => {
    const paid = {
      event: "invoice.status_changed",
      invoice: {
        id: 42,
        external_order_id: apipayOrderId(INV),
        amount: "9900.00",
        status: "paid",
        is_sandbox: true,
      },
    };
    expect(parseApipayWebhook(paid)).toEqual({
      kind: "paid",
      apipayId: "42",
      invoiceId: INV,
      amount: 9900,
      sandbox: true,
    });
    expect(parseApipayWebhook({ ...paid, event: "invoice.qr_scanned" }).kind).toBe("ignored");
    expect(
      parseApipayWebhook({ ...paid, invoice: { ...paid.invoice, status: "expired" } }).kind,
    ).toBe("ignored");
    expect(
      parseApipayWebhook({ ...paid, invoice: { ...paid.invoice, external_order_id: "x" } }).kind,
    ).toBe("ignored");
    expect(parseApipayWebhook(null).kind).toBe("ignored");
    const noFlag = { ...paid, invoice: { ...paid.invoice, is_sandbox: undefined } };
    expect(parseApipayWebhook(noFlag)).toMatchObject({ kind: "paid", sandbox: null });
  });
});
