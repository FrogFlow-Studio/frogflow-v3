import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setFxProvider, resetPricingCache, defaultFxProvider } from "@/core/pricing/pricing";
import { isRetryReason } from "./pure";
import {
  OCR_AUTO_KEY,
  OCR_DELIVER_KEY,
  OCR_USAGE_KEY,
  parseUsage,
  receiptAutoDeliver,
  receiptOcrAutoEnabled,
  sellerReceiptNote,
  verifyCustomerReceipt,
  verifyReceipt,
} from "./verify.server";
import { setReceiptModelForTests } from "./reader.server";
import { RECEIPT_CHECKS_PER_ORDER, receiptChecksKey } from "./attempts";
import type { Customer } from "@/core/customers/customers";
import { mockReceiptModel, resetReceiptModel } from "../../../tests/receipt-model";

const BOT = "00000000-0000-0000-0000-000000000001";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function setup(opts: { ocrModule?: boolean; auto?: string } = {}) {
  const db: FakeDb = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
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

/** Модель «прочитала» в чеке этот текст. */
const mockRead = (text: string) => mockReceiptModel(text);

const IMG = new Uint8Array([1, 2, 3]);
const base = { bytes: IMG, mime: "image/jpeg", expectedAmount: 1000, currency: "KZT", orderId: 99 };

beforeEach(() => setEnvForTests({ ANTHROPIC_API_KEY: "test-key" }));
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
  resetReceiptModel();
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
  it("без модуля receipt_ocr или ключа ИИ — выключено", async () => {
    expect(await receiptOcrAutoEnabled(setup({ ocrModule: false }).ctx)).toBe(false);
    setEnvForTests({});
    expect(await receiptOcrAutoEnabled(setup().ctx)).toBe(false);
  });
});

describe("verifyReceipt — повтор чека по хешу файла", () => {
  it("чек уже принят по другому заказу — receipt_reused, автовыдачи нет", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 42, display_no: 42, order_no: 42, payment_proof_hash: sha(IMG) }];
    mockRead("Оплата успешно. Сумма: 1000 KZT");
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
    mockRead("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("тот же JPEG с байтами в хвосте — всё равно повтор, и старый хэш сырых байтов узнаётся", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9]);
    const tampered = new Uint8Array([...jpeg, 0x00, 0x01, 0xff, 0xd9]);
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 42, display_no: 42, order_no: 42, payment_proof_hash: sha(jpeg) }];
    mockRead("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, { ...base, bytes: tampered })).toMatchObject({
      ok: false,
      reason: "receipt_reused",
    });
    db.tables.orders = [{ id: 42, display_no: 42, payment_proof_hash: sha(tampered) }];
    mockRead("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, { ...base, bytes: tampered })).toMatchObject({
      ok: false,
      reason: "receipt_reused",
    });
  });
  it("чек новый — автовыдача; свой же хеш (записан при приёме чека) не считается повтором", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 99, display_no: 99, payment_proof_hash: sha(IMG) }];
    mockRead("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
});

describe("чек в валюте заказа — без недоплаты (решение 27.09)", () => {
  it("ровная сумма — автопроверка проходит", async () => {
    mockRead("Перевод выполнен. Сумма: 1000 KZT");
    expect(await verifyReceipt(setup().ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("переплата — проходит", async () => {
    mockRead("Перевод выполнен. Сумма: 1100 KZT");
    expect(await verifyReceipt(setup().ctx, base)).toMatchObject({ ok: true, matchedAmount: 1100 });
  });
  it("недоплата на 1 ₸ — к продавцу, не автовыдача и не «пришлите заново»", async () => {
    mockRead("Перевод выполнен. Сумма: 999 KZT");
    const r = await verifyReceipt(setup().ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "amount_mismatch" });
    if (!r.ok) {
      expect(isRetryReason(r.reason)).toBe(false);
      expect(r.detail).toContain("недоплата не принимается");
    }
  });
  it.each([
    ["Перевод выполнен. Сумма 999 ₸. Квитанция № 1150", 1000],
    ["Перевод выполнен. 4 990 ₸. Остаток 5 400 ₸", 5000],
    ["Перевод выполнен. Комиссия 0 ₸. Номер квитанции 1204", 1000],
  ])("номер квитанции или остаток рядом с недоплатой не сходят за оплату: %s", async (t, sum) => {
    mockRead(t);
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: sum });
    expect(r).toMatchObject({ ok: false, reason: "amount_mismatch" });
  });
  it("Kaspi: сумма и «Комиссия 0 ₸» — проходит", async () => {
    mockRead("Перевод выполнен. 5 000 ₸. Комиссия 0 ₸. Квитанция № 12345");
    expect(await verifyReceipt(setup().ctx, { ...base, expectedAmount: 5000 })).toMatchObject({
      ok: true,
      matchedAmount: 5000,
    });
  });
  it("чек без знака валюты — считается валютой заказа, недоплата тоже к продавцу", async () => {
    mockRead("Оплата успешно проведена. Сумма 900");
    expect(await verifyReceipt(setup().ctx, base)).toMatchObject({
      ok: false,
      reason: "amount_mismatch",
    });
  });
});

describe("verifyReceipt — разбор текста и маршрут в модель", () => {
  it("успешный чек с фразой «в случае ошибки» — автовыдача", async () => {
    const { ctx } = setup();
    mockRead("Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в банк.");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("скрин карточки товара вместо чека — not_receipt, просим прислать заново", async () => {
    const { ctx } = setup();
    mockRead("039. Математический тренажёр. 2000 ₸. Продолжить оплату. 0 в корзине.");
    const r = await verifyReceipt(ctx, { ...base, expectedAmount: 800 });
    expect(r).toMatchObject({ ok: false, reason: "not_receipt" });
  });
  it("чек в чужой валюте далеко от суммы заказа — к продавцу, не автовыдача", async () => {
    const { ctx } = setup();
    mockRead("Чек по операции. Сумма в местной валюте 400 KZT.");
    const r = await verifyReceipt(ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(isRetryReason(r.reason)).toBe(false);
  });
  it("PDF без текстового слоя уходит в модель документом и проходит ту же сверку суммы", async () => {
    const { ctx } = setup();
    const model = mockRead("Оплата успешно. Сумма: 1000 KZT");
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const r = await verifyReceipt(ctx, { ...base, bytes: pdf, mime: "application/pdf" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 1000 });
    const file = model.mock.calls[0]![0];
    expect(file.kind).toBe("pdf");
    // Разбор встроенного текста (pdf.js) не должен забрать буфер: в модель уходит сам файл.
    expect(file.base64).toBe(Buffer.from(pdf).toString("base64"));
    expect(pdf.byteLength).toBe(8);
  });
  it("картинка уходит в модель картинкой с типом по байтам", async () => {
    const { ctx } = setup();
    const model = mockRead("Оплата успешно. Сумма: 1000 KZT");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await verifyReceipt(ctx, { ...base, bytes: png, mime: "image/jpeg" });
    expect(model.mock.calls[0]![0]).toMatchObject({ kind: "image", mediaType: "image/png" });
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
    mockRead("Платёж выполнен. Перевод по номеру телефона. 227 ₽");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 1100, currency: "KZT" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 227, matchedCurrency: "RUB" });
  });

  it("Сбер «местная валюта» 1077.30 KZT на заказ 228 ₽ — принимаем (спред банка)", async () => {
    mockRead("Чек по операции. Перевод выполнен. Сумма в местной валюте 1077.30 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 228, currency: "RUB" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 1077.3, matchedCurrency: "KZT" });
  });

  it("чек в другой валюте ниже суммы заказа по курсу — допуск ±30% остаётся", async () => {
    // Заказ 1100 ₸ ≈ 227 ₽; 200 ₽ — на 12% меньше, но в допуске.
    mockRead("Платёж выполнен. Перевод по номеру телефона. 200 ₽");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 1100, currency: "KZT" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 200, matchedCurrency: "RUB" });
  });

  it("Сбер 661.50 KZT на заказ 152 ₽ — ниже рыночного курса, но в допуске ±30%", async () => {
    mockRead("Чек по операции. Перевод выполнен. Сумма в местной валюте 661.50 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r).toMatchObject({ ok: true, matchedAmount: 661.5 });
  });

  it("сумма после курса не сошлась — amount_mismatch, к продавцу", async () => {
    mockRead("Чек по операции. Перевод выполнен. Сумма в местной валюте 400 KZT");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 152, currency: "RUB" });
    expect(r).toMatchObject({ ok: false, reason: "amount_mismatch" });
    if (!r.ok) expect(r.detail).toContain("по курсу");
  });

  it("мелкая валюта: сумма по курсу не округляется до целого — недоплата не проходит", async () => {
    // 700 ₸ ≈ 1,46 $. С округлением до 1 $ окно было 0,70–1,30 $: чек на 0,80 $
    // (55% цены) принимался, а честный 1,46 $ уходил продавцу.
    mockRead("Payment successful. Transfer completed. Amount 0.80 USD");
    const low = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 700, currency: "KZT" });
    expect(low).toMatchObject({ ok: false, reason: "amount_mismatch" });
    mockRead("Payment successful. Transfer completed. Amount 1.46 USD");
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
    mockRead("Платёж выполнен. Перевод по номеру телефона. 227 ₽");
    const r = await verifyReceipt(setup().ctx, { ...base, expectedAmount: 1100, currency: "KZT" });
    expect(r).toMatchObject({ ok: false, reason: "currency_mismatch" });
  });
});

describe("что уходит в модель", () => {
  const box = (brand: string) =>
    new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode(`ftyp${brand}`)]);

  it("HEIC и AVIF модель не читает — не зовём, лимит не тратим, сразу продавцу", async () => {
    for (const brand of ["heic", "avif"]) {
      const { db, ctx } = setup();
      const fetchMock = mockRead("Kaspi Успешно 1 000 ₸");
      const r = await verifyReceipt(ctx, { ...base, bytes: box(brand), mime: "image/jpeg" });
      expect(r).toMatchObject({ ok: false, reason: "ocr_unavailable" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.tables.app_settings!.some((s) => s.key === "receipt_ocr_usage")).toBe(false);
    }
  });

  it("PDF с мусором перед %PDF уходит в модель с %PDF в начале", async () => {
    const { ctx } = setup();
    const model = mockRead("чек");
    const bytes = new TextEncoder().encode("\n\r junk %PDF-1.7 body");
    await verifyReceipt(ctx, { ...base, bytes, mime: "application/octet-stream" });
    expect(model).toHaveBeenCalledTimes(1);
    const file = model.mock.calls[0]![0];
    expect(file.kind).toBe("pdf");
    expect(Buffer.from(file.base64, "base64").toString("latin1")).toBe("%PDF-1.7 body");
  });
});

describe("parseUsage: счётчик проверок чеков", () => {
  it("разбирает счётчик чеков, в том числе голое число v1", () => {
    // v1 хранила в receipt_ocr_usage просто число — после переезда оно не теряется.
    expect(parseUsage("17", "2026-09")).toEqual({ count: 17, month: "2026-09", monthCount: 0 });
    expect(parseUsage("", "2026-09").count).toBe(0);
    expect(parseUsage("-3", "2026-09").count).toBe(0);
    expect(parseUsage("мусор", "2026-09").count).toBe(0);
    expect(
      parseUsage(JSON.stringify({ count: 5, month: "2026-09", monthCount: 2 }), "2026-09"),
    ).toEqual({ count: 5, month: "2026-09", monthCount: 2 });
  });
});

describe("verifyCustomerReceipt — лимит проверок на покупателя", () => {
  const buyer = (): Customer =>
    ({ userKey: "tg_1", telegramId: 1, platform: "telegram", state: {} }) as unknown as Customer;

  it("«не чек» по кругу: сверх лимита заказа модель не зовём, чек уходит продавцу", async () => {
    const { db, ctx } = setup();
    const fetchMock = mockRead("котик на диване");
    let customer = buyer();
    for (let i = 0; i < RECEIPT_CHECKS_PER_ORDER; i++) {
      const r = await verifyCustomerReceipt(ctx, customer, base);
      customer = r.customer;
      expect(r.result.ok).toBe(false);
      if (!r.result.ok) expect(isRetryReason(r.result.reason)).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(RECEIPT_CHECKS_PER_ORDER);
    const over = await verifyCustomerReceipt(ctx, customer, base);
    expect(fetchMock).toHaveBeenCalledTimes(RECEIPT_CHECKS_PER_ORDER);
    expect(over.result).toMatchObject({ ok: false, reason: "check_limit" });
    if (!over.result.ok) expect(isRetryReason(over.result.reason)).toBe(false);
    // Счётчик — своя строка app_settings покупателя: её не затрёт запись состояния диалога.
    const row = db.tables.app_settings!.find((r) => r.key === receiptChecksKey("tg_1"));
    expect(JSON.parse(String(row!.value))).toMatchObject({
      order_id: base.orderId,
      order_n: RECEIPT_CHECKS_PER_ORDER,
    });
  });

  it("альбом из 10 фото разом: модель вызвана не больше лимита заказа, счётчик учёл каждое", async () => {
    const { db, ctx } = setup();
    const fetchMock = mockRead("котик на диване");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => verifyCustomerReceipt(ctx, buyer(), base)),
    );
    expect(fetchMock).toHaveBeenCalledTimes(RECEIPT_CHECKS_PER_ORDER);
    expect(results.filter((r) => !r.result.ok && r.result.reason === "check_limit")).toHaveLength(
      10 - RECEIPT_CHECKS_PER_ORDER,
    );
    const row = db.tables.app_settings!.find((r) => r.key === receiptChecksKey("tg_1"));
    expect(JSON.parse(String(row!.value)).order_n).toBe(RECEIPT_CHECKS_PER_ORDER);
    // Месячный счётчик магазина тоже не теряет параллельные вызовы.
    const usage = db.tables.app_settings!.find((r) => r.key === OCR_USAGE_KEY);
    expect(parseUsage(String(usage!.value)).monthCount).toBe(RECEIPT_CHECKS_PER_ORDER);
  });

  it("настоящий чек в пределах лимита проходит как раньше", async () => {
    const { ctx } = setup();
    mockRead("Kaspi Перевод успешно выполнен\nСумма 1 000 ₸\nКвитанция № 123");
    const r = await verifyCustomerReceipt(ctx, buyer(), base);
    expect(r.result.ok).toBe(true);
  });

  it("старый чек на ту же сумму — receipt_stale, продавцу; свежий — принят", async () => {
    const now = new Date("2026-10-03T07:00:00Z");
    const text = (date: string) =>
      `Kaspi Перевод успешно выполнен\nСумма 1 000 ₸\n${date} 14:12\nКвитанция № 123`;
    const { ctx } = setup();
    mockRead(text("03.09.2026"));
    const old = await verifyCustomerReceipt(ctx, buyer(), base, now);
    expect(old.result).toMatchObject({ ok: false, reason: "receipt_stale" });
    mockRead(text("02.10.2026"));
    const fresh = await verifyCustomerReceipt(ctx, buyer(), { ...base, orderId: 100 }, now);
    expect(fresh.result).toMatchObject({ ok: true, matchedAmount: 1000 });
  });

  it("аудит оператора (без now) старый чек не отсекает", async () => {
    mockRead("Kaspi Перевод успешно выполнен\nСумма 1 000 ₸\n03.09.2026 14:12\nКвитанция № 123");
    expect(await verifyReceipt(setup().ctx, base)).toMatchObject({ ok: true });
  });
});

describe("verifyReceipt — получатель в чеке", () => {
  const withMethod = (instructions: string) => {
    const s = setup();
    s.db.tables.payment_methods = [
      { id: "m1", bot_id: BOT, country_code: "KZ", is_active: true, sort_order: 0, instructions },
    ];
    return s;
  };
  const opts = { ...base, recipientCountry: "KZ" };
  it("получатель совпал — чек принят", async () => {
    const { ctx } = withMethod("Получатель: Иванов Иван, Kaspi +7 705 123-45-67");
    mockRead("Оплата успешно\nПолучатель: Иван И.\nСумма: 1000 KZT");
    expect(await verifyReceipt(ctx, opts)).toMatchObject({ ok: true, matchedAmount: 1000 });
  });
  it("получатель другой — recipient_mismatch, чек уходит продавцу", async () => {
    const { ctx } = withMethod("Получатель: Иванов Иван, Kaspi +7 705 123-45-67");
    mockRead("Оплата успешно\nПолучатель: Пётр С.\nСумма: 1000 KZT");
    const r = await verifyReceipt(ctx, opts);
    expect(r).toMatchObject({ ok: false, reason: "recipient_mismatch" });
    expect(isRetryReason("recipient_mismatch")).toBe(false);
  });
  it("без страны способа оплаты получатель не сверяется", async () => {
    const { ctx } = withMethod("Получатель: Иванов Иван");
    mockRead("Оплата успешно\nПолучатель: Пётр С.\nСумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true });
  });
  it("в реквизитах нечего сверять — чек принят по сумме, как раньше", async () => {
    const { ctx } = withMethod("Переводом на счёт");
    mockRead("Оплата успешно\nПолучатель: Пётр С.\nСумма: 1000 KZT");
    expect(await verifyReceipt(ctx, opts)).toMatchObject({ ok: true });
  });
});

describe("verifyReceipt — повтор того же перевода по номеру квитанции", () => {
  const KASPI = "Kaspi Gold\nПеревод выполнен\nСумма операции 1 000 ₸\nКвитанция № 1234567890";
  const FILE_B = new Uint8Array([9, 9, 9]);

  it("тот же номер, другой файл, другой заказ — receipt_reused со ссылкой на первый заказ", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 98, display_no: 98, order_no: 98 }];
    mockRead(KASPI);
    expect(await verifyReceipt(ctx, { ...base, orderId: 98 })).toMatchObject({ ok: true });
    const r = await verifyReceipt(ctx, { ...base, bytes: FILE_B, orderId: 99 });
    expect(r).toMatchObject({ ok: false, reason: "receipt_reused" });
    if (!r.ok) expect(r.detail).toContain("98");
    // Сам номер в базе не лежит: только хэш цифр.
    const keys = db.tables.app_settings!.map((x) => String(x.key));
    expect(keys.some((k) => k.startsWith("receipt_no:") && !k.includes("1234567890"))).toBe(true);
  });

  it("тот же заказ присылает чек ещё раз — не повтор", async () => {
    const { ctx } = setup();
    mockRead(KASPI);
    await verifyReceipt(ctx, { ...base, orderId: 98 });
    expect(await verifyReceipt(ctx, { ...base, bytes: FILE_B, orderId: 98 })).toMatchObject({
      ok: true,
    });
  });

  it("формат с пробелами и буквами («QR 123 456 7890») — тот же номер", async () => {
    const { ctx } = setup();
    mockRead(KASPI);
    await verifyReceipt(ctx, { ...base, orderId: 98 });
    mockRead("Kaspi Pay\nСумма операции 1 000 ₸\nКвитанция № QR 12 345 67890");
    expect(await verifyReceipt(ctx, { ...base, bytes: FILE_B, orderId: 99 })).toMatchObject({
      ok: false,
      reason: "receipt_reused",
    });
  });

  it("два заказа одновременно — номер достаётся одному", async () => {
    const { ctx } = setup();
    mockRead(KASPI);
    const [a, b] = await Promise.all([
      verifyReceipt(ctx, { ...base, orderId: 98 }),
      verifyReceipt(ctx, { ...base, bytes: FILE_B, orderId: 99 }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  it("чека без номера — работает как раньше; аудит оператора номер не занимает", async () => {
    const { db, ctx } = setup();
    mockRead("Оплата успешно. Сумма: 1000 KZT");
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true });
    mockRead(KASPI);
    await verifyReceipt(ctx, { ...base, orderId: 98, countUsage: false });
    expect(db.tables.app_settings!.some((x) => String(x.key).startsWith("receipt_no:"))).toBe(
      false,
    );
  });
});

describe("чек читает модель: статус, признаки подделки, расход", () => {
  const OK = "Kaspi Перевод успешно выполнен\nСумма 1 000 ₸\n12.10.2026 10:05";
  const setting = (db: FakeDb, key: string) =>
    db.tables.app_settings!.find((r) => r.key === key)?.value;

  it("фото ошибки платежа и «Не проходит» (kopats23, #1435) — не «чек получен», а «платёж не прошёл»", async () => {
    const { ctx } = setup();
    // На экране — сумма заказа, но банк пишет об отказе другими словами.
    mockReceiptModel("Беларусбанк\nПеревод\n7,00 BYN\nОперация не может быть выполнена", {
      status: "failed",
      amount: 7,
      currency: "BYN",
    });
    const r = await verifyReceipt(ctx, { ...base, expectedAmount: 7, currency: "BYN" });
    expect(r).toMatchObject({ ok: false, reason: "payment_failed" });
    if (!r.ok) expect(isRetryReason(r.reason)).toBe(true);
  });

  it("модель видит не чек (скрин заказа с суммой) — not_receipt, хоть сумма и есть", async () => {
    const { ctx } = setup();
    mockReceiptModel("Ваш заказ\nСумма: 1000 KZT\nОплата переводом", { is_receipt: false });
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "not_receipt" });
  });

  it("сумма сошлась, но модель видит следы правки — подозрительный, с причиной, продавцу", async () => {
    const { ctx } = setup();
    mockReceiptModel(OK, { status: "success", edit_signs: ["сумма другим шрифтом"] });
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "receipt_suspicious" });
    if (!r.ok) {
      expect(r.detail).toContain("сумма другим шрифтом");
      expect(isRetryReason(r.reason)).toBe(false);
    }
  });

  it("платёж «в обработке» — подозрительный, не «совпал»", async () => {
    const { ctx } = setup();
    mockReceiptModel(OK, { status: "pending" });
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "receipt_suspicious" });
    if (!r.ok) expect(r.detail).toContain("в обработке");
  });

  it("чек выписан раньше заказа больше чем на сутки — подозрительный; накануне — совпал", async () => {
    const { ctx } = setup();
    mockReceiptModel("Kaspi Перевод успешно выполнен\nСумма 1 000 ₸\n05.10.2026 10:05");
    const old = await verifyReceipt(ctx, { ...base, orderCreatedAt: "2026-10-12T05:00:00Z" });
    expect(old).toMatchObject({ ok: false, reason: "receipt_suspicious" });
    if (!old.ok) expect(old.detail).toContain("раньше создания заказа");
    // 23:10 по Москве 11.10 — в Алматы уже 12.10: запас в сутки.
    mockReceiptModel("Сбербанк\nПлатёж выполнен\nСумма 1 000 ₸\n11.10.2026 23:10");
    const late = await verifyReceipt(ctx, {
      ...base,
      orderId: 100,
      orderCreatedAt: "2026-10-11T20:05:00Z",
    });
    expect(late).toMatchObject({ ok: true, matchedAmount: 1000 });
  });

  it("в тексте нет слов-маркеров, но модель видит чек и сумму — сверка по сумме модели", async () => {
    const { ctx } = setup();
    mockReceiptModel("Kaspi Gold\n1 000\nАнастасия К.", {
      status: "success",
      amount: 1000,
      currency: "KZT",
    });
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: true, matchedAmount: 1000 });
  });

  it("номер операции из разбора модели ловит тот же перевод другим скриншотом", async () => {
    const { ctx } = setup();
    mockReceiptModel(OK, { status: "success", operation_id: "QR 98765 4321" });
    expect(await verifyReceipt(ctx, base)).toMatchObject({ ok: true });
    const other = new Uint8Array([4, 5, 6]);
    const r = await verifyReceipt(ctx, { ...base, bytes: other, orderId: 100 });
    expect(r).toMatchObject({ ok: false, reason: "receipt_reused" });
  });

  it("модель ответила не по схеме — ocr_unavailable, бронь баланса вернулась", async () => {
    const { db, ctx } = setup();
    setReceiptModelForTests(async () => ({ input: null }));
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "ocr_unavailable" });
    expect(JSON.parse(String(setting(db, "ai_balance"))).usd).toBe(5);
  });

  it("списывается фактическая цена ответа и пишется в расход дня по чекам", async () => {
    const { db, ctx } = setup();
    mockReceiptModel(OK);
    await verifyReceipt(ctx, base);
    // 1 600 токенов входа × $0,10 + 200 вывода × $0,50 за миллион.
    const date = new Date().toISOString().slice(0, 10);
    const day = JSON.parse(String(setting(db, `ai_charges:${date}`)));
    expect(day.uses.receipt_ocr).toEqual({ usd: 0.00026, calls: 1 });
    expect(JSON.parse(String(setting(db, "ai_balance"))).usd).toBeCloseTo(5 - 0.00026, 6);
  });

  it("дневной потолок исчерпан — модель не зовём, чек продавцу", async () => {
    const { db, ctx } = setup();
    const date = new Date().toISOString().slice(0, 10);
    db.tables.app_settings!.push(
      { bot_id: BOT, key: "receipt_ocr_daily_usd", value: "0.5" },
      {
        bot_id: BOT,
        key: `ai_charges:${date}`,
        value: JSON.stringify({ date, uses: { receipt_ocr: { usd: 0.5, calls: 600 } } }),
      },
    );
    const model = mockReceiptModel(OK);
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "ocr_unavailable" });
    if (!r.ok) expect(r.detail).toContain("потолок");
    expect(model).not.toHaveBeenCalled();
  });

  it("без ключа ИИ — модель не зовём, автопроверка выключена", async () => {
    resetReceiptModel();
    setEnvForTests({});
    const { ctx } = setup();
    expect(await receiptOcrAutoEnabled(ctx)).toBe(false);
    const r = await verifyReceipt(ctx, base);
    expect(r).toMatchObject({ ok: false, reason: "ocr_unavailable" });
  });

  it("продавцу: совпал — с тем, что прочитано, и напоминанием проверить банк", async () => {
    const { ctx } = setup();
    mockReceiptModel(OK, {
      status: "success",
      amount: 1000,
      currency: "KZT",
      operation_id: "123456789",
      recipient: "Анастасия К.",
    });
    const r = await verifyReceipt(ctx, base);
    expect(r.ok).toBe(true);
    const note = sellerReceiptNote(r);
    expect(note).toContain("Чек совпал");
    expect(note).toContain("1000 KZT");
    expect(note).toContain("№ 123456789");
    expect(note).toContain("Проверьте поступление в банке");
  });
});

describe("выдача сразу — переключатель продавца", () => {
  it("по умолчанию выключена, «on» включает", async () => {
    expect(await receiptAutoDeliver(setup().ctx)).toBe(false);
    const { db, ctx } = setup();
    db.tables.app_settings!.push({ bot_id: BOT, key: OCR_DELIVER_KEY, value: "on" });
    expect(await receiptAutoDeliver(ctx)).toBe(true);
  });
});
