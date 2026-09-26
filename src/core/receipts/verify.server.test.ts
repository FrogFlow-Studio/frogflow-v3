import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setFxProvider, resetPricingCache, defaultFxProvider } from "@/core/pricing/pricing";
import { isRetryReason } from "./pure";
import { OCR_AUTO_KEY, receiptOcrAutoEnabled, verifyReceipt } from "./verify.server";

const BOT = "00000000-0000-0000-0000-000000000001";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function setup(opts: { ocrModule?: boolean; auto?: string } = {}) {
  const db: FakeDb = fakeDb();
  db.tables.app_settings =
    opts.auto === undefined ? [] : [{ bot_id: BOT, key: OCR_AUTO_KEY, value: opts.auto }];
  db.tables.orders = [];
  const ctx = {
    tenant: {
      id: BOT,
      plan: null,
      settings: {},
      modules: { receipt_ocr: opts.ocrModule ?? true },
    },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

/** Ответ Vision на картинку. */
const visionImage = (text: string) =>
  new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function mockVision(text: string) {
  const fetchMock = vi.fn(async () => visionImage(text));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const IMG = new Uint8Array([1, 2, 3]);
const base = { bytes: IMG, mime: "image/jpeg", expectedAmount: 1000, currency: "KZT", orderId: 99 };

beforeEach(() => setEnvForTests({ GOOGLE_VISION_API_KEY: "test-key" }));
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("receiptOcrAutoEnabled — тумблер автопроверки продавца", () => {
  it("без ключа и с true — автопроверка включена", async () => {
    expect(await receiptOcrAutoEnabled(setup().ctx)).toBe(true);
    expect(await receiptOcrAutoEnabled(setup({ auto: "true" }).ctx)).toBe(true);
  });
  it("явное false выключает автопроверку", async () => {
    expect(await receiptOcrAutoEnabled(setup({ auto: "false" }).ctx)).toBe(false);
  });
  it("вход в OCR решает тумблер: включён — чек читаем, без отдельного флага заказа", async () => {
    // Каналы (Telegram, Zernio) зовут OCR только по receiptOcrAutoEnabled — другого флага нет.
    expect(await receiptOcrAutoEnabled(setup({ auto: "true" }).ctx)).toBe(true);
  });
  it("тумблер выключен — обычный заказ, OCR нет", async () => {
    expect(await receiptOcrAutoEnabled(setup({ auto: "false" }).ctx)).toBe(false);
  });
  it("без модуля receipt_ocr или ключа Vision — выключено", async () => {
    expect(await receiptOcrAutoEnabled(setup({ ocrModule: false }).ctx)).toBe(false);
    setEnvForTests({});
    expect(await receiptOcrAutoEnabled(setup().ctx)).toBe(false);
  });
});

describe("verifyReceipt — повтор чека по хешу файла", () => {
  it("чек уже принят по другому заказу — receipt_reused, автовыдачи нет", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 42, display_no: 42, order_no: 42, payment_proof_hash: sha(IMG) }];
    mockVision("Оплата успешно. Сумма: 1000 KZT");
    const r = await verifyReceipt(ctx, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("receipt_reused");
      expect(r.detail).toContain("42");
    }
  });
  it("хеш — sha256 байтов: другие байты по тому же заказу 42 — не повтор", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [
      { id: 42, display_no: 42, payment_proof_hash: sha(new Uint8Array([1, 2, 4])) },
    ];
    mockVision("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("чек новый — автовыдача; свой же хеш (записан при приёме чека) не считается повтором", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 99, display_no: 99, payment_proof_hash: sha(IMG) }];
    mockVision("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
});

describe("verifyReceipt — разбор текста и маршрут в Vision", () => {
  it("успешный чек с фразой «в случае ошибки» — автовыдача", async () => {
    const { ctx } = setup();
    mockVision("Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в банк.");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("скрин карточки товара вместо чека — not_receipt, просим прислать заново", async () => {
    const { ctx } = setup();
    mockVision("039. Математический тренажёр. 2000 ₸. Продолжить оплату. 0 в корзине.");
    const r = await verifyReceipt(ctx, { ...base, expectedAmount: 800 });
    expect(r).toMatchObject({ ok: false, reason: "not_receipt" });
  });
  it("чек в чужой валюте далеко от суммы заказа — к продавцу, не автовыдача", async () => {
    const { ctx } = setup();
    mockVision("Чек по операции. Сумма в местной валюте 400 KZT.");
    const r = await verifyReceipt(ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(isRetryReason(r.reason)).toBe(false);
  });
  it("PDF идёт в files:annotate и проходит ту же сверку суммы", async () => {
    const { ctx } = setup();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            responses: [
              { responses: [{ fullTextAnnotation: { text: "Оплата успешно. Сумма: 1000 KZT" } }] },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const r = await verifyReceipt(ctx, { ...base, bytes: pdf, mime: "application/pdf" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 1000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("files:annotate");
    const body = JSON.parse(String(init.body));
    expect(body.requests[0].inputConfig.mimeType).toBe("application/pdf");
    expect(body.requests[0].pages).toEqual([1, 2, 3, 4, 5]);
  });
  it("картинка идёт в images:annotate", async () => {
    const { ctx } = setup();
    const fetchMock = mockVision("Оплата успешно. Сумма: 1000 KZT");
    await verifyReceipt(ctx, base);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain(
      "images:annotate",
    );
  });
});

/** Курсы к USD: 1 USD = 480 ₸ = 97 ₽ (порядок реальных, числа круглые для проверки). */
const RATES = { USD: 1, KZT: 480, RUB: 97 };

describe("чек в чужой валюте — сумма заказа переводится по курсу, как в v1", () => {
  beforeEach(() => setFxProvider(async () => RATES));
  afterEach(() => {
    setFxProvider(defaultFxProvider);
    resetPricingCache();
  });

  it("на экране только 227 ₽ — переводим заказ 1100 ₸ и принимаем", async () => {
    mockVision("Платёж выполнен. Перевод по номеру телефона. 227 ₽");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 1100, currency: "KZT" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 227, matchedCurrency: "RUB" });
  });

  it("Сбер «местная валюта» 1077.30 KZT на заказ 228 ₽ — принимаем (спред банка)", async () => {
    mockVision("Чек по операции. Перевод выполнен. Сумма в местной валюте 1077.30 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 228, currency: "RUB" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 1077.3, matchedCurrency: "KZT" });
  });

  it("Сбер 661.50 KZT на заказ 152 ₽ — ниже рыночного курса, но в допуске ±30%", async () => {
    mockVision("Чек по операции. Перевод выполнен. Сумма в местной валюте 661.50 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 661.5 });
  });

  it("сумма после курса не сошлась — amount_mismatch, к продавцу", async () => {
    mockVision("Чек по операции. Перевод выполнен. Сумма в местной валюте 400 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r).toMatchObject({ ok: false, reason: "amount_mismatch" });
    if (!r.ok) expect(r.detail).toContain("по курсу");
  });

  it("мелкая валюта: сумма по курсу не округляется до целого — недоплата не проходит", async () => {
    // 700 ₸ ≈ 1,46 $. С округлением до 1 $ окно было 0,70–1,30 $: чек на 0,80 $
    // (55% цены) принимался, а честный 1,46 $ уходил продавцу.
    mockVision("Payment successful. Transfer completed. Amount 0.80 USD");
    const low = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 700, currency: "KZT" });
    expect(low).toMatchObject({ ok: false, reason: "amount_mismatch" });
    mockVision("Payment successful. Transfer completed. Amount 1.46 USD");
    const fair = await verifyReceipt(setup().ctx, {
      ...base,
      expectedAmount: 700,
      currency: "KZT",
    });
    expect(fair).toMatchObject({ ok: true, matchedAmount: 1.46, matchedCurrency: "USD" });
  });

  it("курс недоступен — как раньше: currency_mismatch, к продавцу", async () => {
    setFxProvider(async () => {
      throw new Error("нет сети");
    });
    mockVision("Платёж выполнен. Перевод по номеру телефона. 227 ₽");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 1100, currency: "KZT" });
    expect(r).toMatchObject({ ok: false, reason: "currency_mismatch" });
  });
});
