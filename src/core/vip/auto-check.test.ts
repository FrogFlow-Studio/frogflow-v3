import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  autoCheckVipProof,
  markVipProof,
  receiptDateProblem,
  receiptDates,
  receiptPaymentNo,
} from "./auto-check";
import { getSubscription, type VipGroup } from "./vip";

/**
 * Автопроверка чека за VIP-подписку: по настройке продавца (по умолчанию
 * выключена), той же сверкой, что заказы, — сошлось, подписка продлена;
 * недоплата, чужой чек или повтор того же файла — решение за продавцом.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const SUB = "5ab10000-0000-4000-8000-000000000001";
const SUB2 = "5ab20000-0000-4000-8000-000000000002";

function setup(opts: { auto?: boolean } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: BOT, key: "vip_group_id", value: "-100500" },
    ...(opts.auto === false ? [] : [{ bot_id: BOT, key: "vip_auto_confirm", value: "true" }]),
  ];
  db.tables.orders = [];
  db.tables.zernio_logs = [];
  const tariff = { id: "t-1", name: "Месяц", price: 5000, currency: "KZT", duration_days: 30 };
  const pending = (id: string, telegram_id: number) => ({
    id,
    bot_id: BOT,
    telegram_id,
    status: "pending_payment",
    created_at: "2026-09-27T06:00:00Z",
    expires_at: new Date().toISOString(),
    group_invite_link: null,
    tariff_id: "t-1",
    vip_tariffs: tariff,
  });
  db.tables.vip_subscriptions = [pending(SUB, 777), pending(SUB2, 888)];
  const group = {
    member: vi.fn(async () => null),
    createInvite: vi.fn(async () => "https://t.me/+invite"),
    revokeInvite: vi.fn(async () => {}),
    kick: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async () => true),
  } satisfies VipGroup;
  const ctx = {
    tenant: { id: BOT, plan: null, settings: {}, modules: { receipt_ocr: true } },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  const sub = async (id = SUB) => (await getSubscription(ctx, id))!;
  return { db, ctx, group, sub };
}

function mockVision(text: string) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const file = (n: number) => ({ bytes: new Uint8Array([9, 8, n]), mime: "image/jpeg" });

beforeEach(() => setEnvForTests({ GOOGLE_VISION_API_KEY: "test-key" }));
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("автопроверка чека VIP-подписки", () => {
  it("по умолчанию выключена — чек не читаем, решает продавец", async () => {
    const { ctx, group, sub } = setup({ auto: false });
    const fetchMock = mockVision("Сумма: 5000 KZT");
    expect(await autoCheckVipProof(ctx, group, await sub(), file(1))).toEqual({ status: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await sub()).status).toBe("pending_payment");
  });

  it("чек на цену тарифа — подписка оформлена сама, ссылка покупателю, запись в журнале", async () => {
    const { db, ctx, group, sub } = setup();
    mockVision("Перевод выполнен 27.09.2026 12:00. № квитанции 123456789. Сумма: 5 000 ₸");
    const r = await autoCheckVipProof(ctx, group, await sub(), file(1));
    expect(r).toMatchObject({
      status: "confirmed",
      amount: 5000,
      paymentNo: "123456789",
      renewed: false,
      deliveryFailed: false,
    });
    expect(db.tables.zernio_logs![0]).toMatchObject({
      event_type: "vip.auto_confirmed",
      payload: {
        subscription_id: SUB,
        amount: 5000,
        currency: "KZT",
        payment_no: "123456789",
        note: "подтверждено автоматически",
      },
    });
    expect((await sub()).status).toBe("active");
    expect(group.send).toHaveBeenCalledOnce();
  });

  it("недоплата в той же валюте — к продавцу с причиной, подписка ждёт", async () => {
    const { ctx, group, sub } = setup();
    mockVision("Перевод выполнен 27.09.2026 12:00. Сумма: 4 999 ₸");
    const r = await autoCheckVipProof(ctx, group, await sub(), file(1));
    expect(r.status).toBe("manual");
    expect((await sub()).status).toBe("pending_payment");
    expect(group.send).not.toHaveBeenCalled();
  });

  it("тот же файл по другой заявке — не продлевает второй раз", async () => {
    const { ctx, group, sub } = setup();
    mockVision("Перевод выполнен 27.09.2026 12:00. Сумма: 5 000 ₸");
    expect((await autoCheckVipProof(ctx, group, await sub(), file(1))).status).toBe("confirmed");
    const again = await autoCheckVipProof(ctx, group, await sub(SUB2), file(1));
    expect(again).toMatchObject({
      status: "manual",
      reason: expect.stringMatching(/другой заявке/),
    });
    expect((await sub(SUB2)).status).toBe("pending_payment");
  });

  it("чек, уже принятый по заказу магазина, — к продавцу", async () => {
    const { db, ctx, group, sub } = setup();
    const { proofHashes } = await import("@/core/orders/proof-hash");
    db.tables.orders!.push({
      id: 5,
      order_no: 5,
      payment_proof_hash: proofHashes(file(1).bytes).stored,
    });
    mockVision("Перевод выполнен 27.09.2026 12:00. Сумма: 5 000 ₸");
    const r = await autoCheckVipProof(ctx, group, await sub(), file(1));
    expect(r).toMatchObject({ status: "manual", reason: expect.stringMatching(/заказу №5/) });
  });

  it("не чек или сбой разбора — к продавцу, без продления", async () => {
    const { ctx, group, sub } = setup();
    mockVision("котик на диване");
    expect((await autoCheckVipProof(ctx, group, await sub(), file(2))).status).toBe("manual");
    expect((await sub()).status).toBe("pending_payment");
  });

  it("чек, присланный по другой заявке и подтверждённый руками, — к продавцу", async () => {
    const { ctx, group, sub } = setup();
    // Приём чека занял отпечаток за первой заявкой, продавец подтвердил её сам.
    await markVipProof(ctx, SUB, file(3).bytes);
    mockVision("Перевод выполнен 27.09.2026 12:00. Сумма: 5 000 ₸");
    const r = await autoCheckVipProof(ctx, group, await sub(SUB2), file(3));
    expect(r).toMatchObject({ status: "manual", reason: expect.stringMatching(/другой заявке/) });
  });

  it("чек старше заявки или без даты — к продавцу", async () => {
    const { ctx, group, sub } = setup();
    mockVision("Перевод выполнен 20.08.2026 12:00. Сумма: 5 000 ₸");
    expect(await autoCheckVipProof(ctx, group, await sub(), file(4))).toMatchObject({
      status: "manual",
      reason: expect.stringMatching(/раньше заявки/),
    });
    mockVision("Перевод выполнен. Сумма: 5 000 ₸");
    expect(await autoCheckVipProof(ctx, group, await sub(), file(5))).toMatchObject({
      status: "manual",
      reason: expect.stringMatching(/не нашлась дата/),
    });
    expect((await sub()).status).toBe("pending_payment");
  });

  it("чек, присланный за VIP, заказ магазина не оплачивает автоматически", async () => {
    const { ctx } = setup();
    await markVipProof(ctx, SUB, file(6).bytes);
    mockVision("Перевод выполнен 27.09.2026 12:00. Сумма: 5 000 ₸");
    const { verifyReceipt } = await import("@/core/receipts/verify.server");
    const r = await verifyReceipt(ctx, {
      bytes: file(6).bytes,
      mime: "image/jpeg",
      expectedAmount: 5000,
      currency: "KZT",
      orderId: 42,
    });
    expect(r).toMatchObject({ ok: false, reason: "receipt_reused" });
  });
});

describe("дата и номер платежа в чеке", () => {
  it("даты в разных записях, без года — не берём", () => {
    expect(receiptDates("27.09.2026 14:35")).toEqual(["2026-09-27"]);
    expect(receiptDates("27.09.26")).toEqual(["2026-09-27"]);
    expect(receiptDates("Дата: 3 сентября 2026 г.")).toEqual(["2026-09-03"]);
    expect(receiptDates("27 мая 2026")).toEqual(["2026-05-27"]);
    expect(receiptDates("27 сентября, 14:35")).toEqual([]);
    expect(receiptDates("Сумма 5 000,00 ₸")).toEqual([]);
  });

  it("чек днём раньше заявки проходит (оплатил, потом выбрал тариф)", () => {
    expect(receiptDateProblem("26.09.2026", "2026-09-27T06:00:00Z", "Asia/Almaty")).toBeNull();
    expect(receiptDateProblem("24.09.2026", "2026-09-27T06:00:00Z", "Asia/Almaty")).toMatch(
      /24\.09\.2026/,
    );
  });

  it("номер платежа по подписи", () => {
    expect(receiptPaymentNo("№ квитанции: QR123456")).toBe("QR123456");
    expect(receiptPaymentNo("Номер чека 000987654")).toBe("000987654");
    expect(receiptPaymentNo("Сумма 5000 ₸")).toBeNull();
  });
});
