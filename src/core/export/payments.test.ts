import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { paymentsCsv, proofMethod } from "./payments";

const SHOP = "shop-1";
let db: FakeDb;
const ctx = () =>
  ({ tenant: { id: SHOP }, db, timezone: "Asia/Almaty" }) as unknown as TenantContext;

const order = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  bot_id: SHOP,
  order_no: id,
  display_no: 1000 + id,
  created_at: "2026-09-01T05:00:00Z",
  status: "delivered",
  total: 5000,
  paid_amount: 0,
  currency: "KZT",
  telegram_id: 77,
  display_name: "Анна Покупатель",
  contact: "+77001234567",
  platform: "telegram",
  fulfillment_kind: "digital",
  payment_proof_path: "proofs/77/1.jpg",
  ...extra,
});

let seq = 0;
const ev = (
  orderId: number,
  kind: string,
  at: string,
  payload: Record<string, unknown> = {},
  bot_id = SHOP,
) => ({
  id: `ev-${String(++seq).padStart(4, "0")}`,
  bot_id,
  event_id: `order:${orderId}:${kind}:${seq}`,
  event_type: `order.${kind}`,
  status: "event",
  created_at: at,
  payload: { order_id: orderId, actor: "bot", ...payload },
});

async function rows(range = {}) {
  const { csv, count } = await paymentsCsv(ctx(), range);
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
  return { header: lines[0]!, lines: lines.slice(1), count };
}

beforeEach(() => {
  // Заказы старше срока журнала выдачей не считаются — «сейчас» фиксируем.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T00:00:00Z") });
  seq = 0;
  db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [];
  db.tables.zernio_logs = [];
});

afterEach(() => vi.useRealTimers());

describe("выгрузка «Оплаты»", () => {
  it("строка на каждый платёж, по дате оплаты, без контактов покупателя", async () => {
    db.tables.orders = [
      order(1),
      order(2, { fulfillment_kind: "physical", total: 20000, status: "accepted" }),
      order(3, { payment_proof_path: "Robokassa", total: 3000 }),
    ];
    db.tables.zernio_logs = [
      ev(1, "placed", "2026-09-10T04:00:00Z"),
      ev(1, "proof", "2026-09-10T04:05:00Z"),
      ev(1, "delivery_started", "2026-09-10T05:00:00Z", { actor: "admin:olga" }),
      ev(2, "payment", "2026-09-11T06:00:00Z", {
        amount: 6000,
        currency: "KZT",
        source: "deposit",
        actor: "admin:olga",
      }),
      ev(2, "balance_credited", "2026-09-12T07:00:00Z", {
        amount: 14000,
        currency: "KZT",
        source: "balance",
        provider: "Robokassa",
        invId: "2000000002",
        actor: "robokassa",
      }),
      ev(3, "payment", "2026-09-13T08:00:00Z", {
        amount: 3000,
        currency: "KZT",
        source: "online",
        provider: "Robokassa",
        actor: "system",
      }),
      ev(3, "delivery_started", "2026-09-13T08:00:05Z"),
    ];
    const { header, lines, count } = await rows();
    expect(count).toBe(4);
    expect(header).toBe(
      "Дата оплаты;Заказ;Вид платежа;Способ;Сумма;Валюта;Номер счёта;Кто записал;Канал заказа;Статус заказа",
    );
    expect(lines).toEqual([
      "2026-09-10 10:00;1001;оплата заказа;перевод по чеку;5000;KZT;;olga;telegram;выдан",
      "2026-09-11 11:00;1002;задаток;перевод по чеку;6000;KZT;;olga;telegram;принят в работу",
      "2026-09-12 12:00;1002;остаток;Robokassa;14000;KZT;2000000002;автоматически;telegram;принят в работу",
      "2026-09-13 13:00;1003;оплата заказа;Robokassa;3000;KZT;;автоматически;telegram;выдан",
    ]);
    const csv = (await paymentsCsv(ctx())).csv;
    expect(csv).not.toContain("Анна");
    expect(csv).not.toContain("+7700");
  });

  it("повторная выдача — не новый платёж, даже если первая была до периода", async () => {
    db.tables.orders = [order(1)];
    db.tables.zernio_logs = [
      ev(1, "delivery_started", "2026-08-20T05:00:00Z"),
      ev(1, "delivery_started", "2026-09-15T05:00:00Z"),
    ];
    expect((await rows({ from: "2026-09-01", to: "2026-09-30" })).count).toBe(0);
    const all = await rows();
    expect(all.count).toBe(1);
    expect(all.lines[0]).toMatch(/^2026-08-20 /);
  });

  it("границы периода — дни в поясе магазина, включительно", async () => {
    db.tables.orders = [order(1), order(2), order(3)];
    db.tables.zernio_logs = [
      // 2026-09-01 04:30 по Алматы — ещё 31 августа по UTC.
      ev(1, "delivery_started", "2026-08-31T22:30:00Z"),
      ev(2, "delivery_started", "2026-09-30T18:59:00Z"),
      ev(3, "delivery_started", "2026-09-30T19:01:00Z"),
    ];
    const r = await rows({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.lines.map((l) => l.split(";")[1])).toEqual(["1001", "1002"]);
  });

  it("физический заказ по выдаче и заказ целиком за сертификат — без строки", async () => {
    db.tables.orders = [
      order(1, { fulfillment_kind: "physical" }),
      order(2, { total: 0, payment_proof_path: null }),
    ];
    db.tables.zernio_logs = [
      ev(1, "delivery_started", "2026-09-10T05:00:00Z"),
      ev(2, "delivery_started", "2026-09-10T05:00:00Z"),
    ];
    expect((await rows()).count).toBe(0);
  });

  it("чужой магазин и чужие события не попадают", async () => {
    db.tables.orders = [order(1), { ...order(2), bot_id: "shop-2" }];
    db.tables.zernio_logs = [
      ev(2, "payment", "2026-09-10T05:00:00Z", { amount: 100 }, "shop-2"),
      ev(1, "payment", "2026-09-10T05:00:00Z", { amount: 100 }, "shop-2"),
    ];
    expect((await rows()).count).toBe(0);
  });

  it("внесено продавцом и больше 1000 платежей — постранично", async () => {
    db.tables.orders = [order(1, { fulfillment_kind: "physical", total: 2_000_000 })];
    db.tables.zernio_logs = Array.from({ length: 1200 }, (_, i) =>
      ev(1, "payment", new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(), {
        amount: 1000,
        currency: "KZT",
        actor: "admin:olga",
      }),
    );
    const r = await rows();
    expect(r.count).toBe(1200);
    expect(r.lines[0]).toContain(";внесено;вручную продавцом;1000;");
  });

  it("история выдач длиннее 1000 строк — постранично: платёж в конце не теряется", async () => {
    db.tables.orders = [order(1)];
    db.tables.zernio_logs = [
      ev(1, "delivery_started", "2026-09-02T05:00:00Z"),
      ...Array.from({ length: 1100 }, (_, i) =>
        ev(1, "delivery_started", new Date(Date.UTC(2026, 8, 5) + i * 60_000).toISOString()),
      ),
      ev(1, "payment", "2026-09-20T05:00:00Z", { amount: 5000, currency: "KZT" }),
    ];
    // В периоде только первая выдача; платёж у заказа есть — выдача не деньги.
    expect((await rows({ from: "2026-09-01", to: "2026-09-03" })).count).toBe(0);
  });

  it("выдача без чека и без отметки шлюза — не платёж", async () => {
    db.tables.orders = [order(1, { payment_proof_path: null })];
    db.tables.zernio_logs = [ev(1, "delivery_started", "2026-09-10T05:00:00Z")];
    expect((await rows()).count).toBe(0);
  });

  it("заказ старше срока журнала: его выдача может быть повторной — не платёж", async () => {
    db.tables.orders = [order(1, { created_at: "2026-03-01T05:00:00Z" })];
    db.tables.zernio_logs = [ev(1, "delivery_started", "2026-09-10T05:00:00Z")];
    expect((await rows()).count).toBe(0);
  });

  it("онлайн-оплата части физического заказа — задаток, с номером платежа", async () => {
    db.tables.orders = [order(1, { fulfillment_kind: "physical", total: 20000 })];
    db.tables.zernio_logs = [
      ev(1, "payment", "2026-09-10T05:00:00Z", {
        amount: 6000,
        currency: "KZT",
        source: "online",
        provider: "Robokassa",
        invId: "123",
        actor: "system",
      }),
    ];
    expect((await rows()).lines).toEqual([
      "2026-09-10 10:00;1001;задаток;Robokassa;6000;KZT;123;автоматически;telegram;выдан",
    ]);
  });

  it("способ оплаты по отметке заказа", () => {
    expect(proofMethod(null)).toBe("без чека");
    expect(proofMethod("Robokassa")).toBe("Robokassa");
    expect(proofMethod("Telegram Stars (50 ⭐, ch_1)")).toBe("Telegram Stars");
    expect(proofMethod("proofs/1/2.jpg")).toBe("перевод по чеку");
  });
});
