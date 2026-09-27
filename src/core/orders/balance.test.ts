import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const uploaded: string[] = [];
const removed: string[][] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploaded.push(key);
          return { data: {}, error: null };
        },
        remove: async (keys: string[]) => {
          removed.push(keys);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const {
  attachBalanceProof,
  balanceDue,
  balanceInvId,
  balancePayable,
  claimBalanceInvId,
  lastBalanceProofPath,
  rejectBalanceProof,
  parseRobokassaInvId,
  recordBalancePaidOnline,
} = await import("./balance");
const { describeOrderEvent, listOrderEvents } = await import("./events");

const BOT = "00000000-0000-0000-0000-0000000000bb";
let db: FakeDb;
const ctx = () => ({ tenant: { id: BOT, modules: {} }, db }) as unknown as TenantContext;
const jpeg = (n: number) => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, n]), mime: "image/jpeg" });
const order = () =>
  db.tables.orders![0]! as never as {
    id: number;
    status: string;
    fulfillment_kind: string;
    total: number;
    paid_amount: number;
    payment_proof_hash: string;
  };

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.orders = [
    {
      id: 7,
      bot_id: BOT,
      status: "in_production",
      fulfillment_kind: "physical",
      total: 10000,
      paid_amount: 3000,
      currency: "KZT",
      payment_proof_hash: "deposit-hash",
    },
  ];
  db.tables.zernio_logs = [];
  uploaded.length = 0;
  removed.length = 0;
});

describe("остаток по задатку", () => {
  it("остаток — total − paid_amount, только у физического заказа в работе с задатком", () => {
    const o = { status: "accepted", fulfillment_kind: "physical", total: 10000, paid_amount: 3000 };
    expect(balanceDue(o)).toBe(7000);
    expect(balanceDue({ ...o, status: "ready" })).toBe(7000);
    expect(balanceDue({ ...o, paid_amount: "2999.99" })).toBe(7000.01);
    for (const status of ["awaiting_payment", "awaiting_confirmation", "delivered", "cancelled"])
      expect(balanceDue({ ...o, status })).toBe(0);
    expect(balanceDue({ ...o, fulfillment_kind: "digital" })).toBe(0);
    // Оплата при получении: задатка нет — доплачивать нечего, платят при выдаче.
    expect(balanceDue({ ...o, paid_amount: 0 })).toBe(0);
    expect(balanceDue({ ...o, paid_amount: null })).toBe(0);
    // Всё внесено (копейка округления — не остаток).
    expect(balanceDue({ ...o, paid_amount: 10000 })).toBe(0);
    expect(balanceDue({ ...o, paid_amount: 9999.995 })).toBe(0);
  });

  it("InvId остатка отличается от InvId заказа и разбирается обратно", () => {
    expect(parseRobokassaInvId("7")).toEqual({ orderId: 7, balance: false });
    expect(balanceInvId(7, 0)).toBe(1_000_000_000_070_000);
    expect(parseRobokassaInvId(String(balanceInvId(7, 0)))).toEqual({ orderId: 7, balance: true });
    expect(parseRobokassaInvId(String(balanceInvId(7, 3)))).toEqual({ orderId: 7, balance: true });
    expect(balanceInvId(7, 1)).not.toBe(balanceInvId(7, 0));
    expect(parseRobokassaInvId(String(balanceInvId(123456789, 9999)))).toEqual({
      orderId: 123456789,
      balance: true,
    });
    for (const bad of [
      "",
      "0",
      "-1",
      "1.5",
      "abc",
      "1000000000000000",
      "1000000000009999",
      "99999999999999999",
    ])
      expect(parseRobokassaInvId(bad)).toBeNull();
  });

  it("чек на остаток: файл в бакет, событие у заказа; второй чек — отказ, карта закрыта", async () => {
    expect(await balancePayable(ctx(), order())).toBe(7000);
    const r = await attachBalanceProof(ctx(), order(), jpeg(1));
    expect(r).toMatchObject({ ok: true, due: 7000 });
    expect(uploaded[0]).toMatch(new RegExp(`^${BOT}/order-7/balance-\\d+\\.jpg$`));
    const events = await listOrderEvents(ctx(), 7);
    expect(events).toEqual([expect.objectContaining({ kind: "balance_proof", actor: "customer" })]);
    expect(lastBalanceProofPath(events)).toBe(uploaded[0]);
    expect(describeOrderEvent(events[0]!).text).toContain("Чек на остаток 7000");
    // Пока продавец не решил — ни второго чека, ни оплаты картой.
    expect(await balancePayable(ctx(), order())).toBe(0);
    expect(await attachBalanceProof(ctx(), order(), jpeg(2))).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // Продавец внёс часть — остаток новый, чек на него снова можно прислать.
    order().paid_amount = 5000;
    expect(await balancePayable(ctx(), order())).toBe(5000);
  });

  it("тот же файл, что чек задатка или чек остатка другого заказа, — отказ без загрузки", async () => {
    const { proofHashes } = await import("./proof-hash");
    order().payment_proof_hash = proofHashes(jpeg(3).bytes).stored;
    expect(await attachBalanceProof(ctx(), order(), jpeg(3))).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(uploaded).toHaveLength(0);

    db.tables.orders!.push({ ...order(), id: 8, payment_proof_hash: "other" });
    const other = db.tables.orders![1]! as never as Parameters<typeof attachBalanceProof>[1];
    expect(await attachBalanceProof(ctx(), other, jpeg(5))).toMatchObject({ ok: true });
    expect(await attachBalanceProof(ctx(), order(), jpeg(5))).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(uploaded).toHaveLength(1);
  });

  it("не картинка и не PDF — отказ; заказ без остатка — не наш путь (null)", async () => {
    expect(
      await attachBalanceProof(ctx(), order(), {
        bytes: new Uint8Array([1, 2, 3]),
        mime: "image/jpeg",
      }),
    ).toEqual({ ok: false, reason: "invalid_file" });
    order().status = "awaiting_payment";
    expect(await attachBalanceProof(ctx(), order(), jpeg(4))).toBeNull();
  });

  it("оплата картой: пишется один раз, повтор колбэка ничего не меняет", async () => {
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "recorded",
    );
    expect(order().paid_amount).toBe(10000);
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "duplicate",
    );
    expect(order().paid_amount).toBe(10000);
    const events = await listOrderEvents(ctx(), 7);
    expect(events.map((e) => e.kind)).toEqual(["balance_paid", "balance_credited"]);
    // «Платёж получен» — нейтрально, с номером счёта; «внесён» — зелёным.
    expect(describeOrderEvent(events[0]!)).toMatchObject({ tone: "neutral" });
    expect(describeOrderEvent(events[0]!).text).toContain("счёт №inv");
    expect(describeOrderEvent(events[1]!)).toMatchObject({ tone: "ok" });
  });

  it("каждая выданная ссылка — свой номер счёта; оплата по второй открытой ссылке не «повтор»", async () => {
    const a = await claimBalanceInvId(ctx(), 7, 7000);
    const b = await claimBalanceInvId(ctx(), 7, 7000);
    expect(a).toBe(balanceInvId(7, 0));
    expect(b).toBe(balanceInvId(7, 1));
    expect(await claimBalanceInvId(ctx(), 70, 1)).toBe(balanceInvId(70, 0));
    order().total = 17000;
    // Покупатель оплатил обе ссылки: обе оплаты записаны.
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", String(a))).result).toBe(
      "recorded",
    );
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", String(b))).result).toBe(
      "recorded",
    );
    expect(order().paid_amount).toBe(17000);
  });

  it("гонка за номер счёта: чужая попытка заняла номер — берём следующий", async () => {
    db.tables.zernio_logs!.push({
      id: "x",
      event_id: "order:7:balance_link:1",
      event_type: "order.balance_link",
      status: "event",
      payload: { order_id: 7 },
      created_at: "2026-09-27T00:00:00Z",
    });
    // Счётчик видит одну ссылку (номер 1), номер 1 занят — выдаётся 2.
    expect(await claimBalanceInvId(ctx(), 7, 7000)).toBe(balanceInvId(7, 2));
  });

  it("продавец отклонил чек на остаток — покупатель снова платит картой или шлёт новый чек", async () => {
    expect(await rejectBalanceProof(ctx(), 7, "admin:anna")).toBe(false);
    expect((await attachBalanceProof(ctx(), order(), jpeg(1)))?.ok).toBe(true);
    expect(await balancePayable(ctx(), order())).toBe(0);
    expect(await rejectBalanceProof(ctx(), 7, "admin:anna")).toBe(true);
    // Повторное нажатие — уже нечего отклонять.
    expect(await rejectBalanceProof(ctx(), 7, "admin:anna")).toBe(false);
    expect(await balancePayable(ctx(), order())).toBe(7000);
    const events = await listOrderEvents(ctx(), 7);
    expect(describeOrderEvent(events.at(-1)!).text).toContain("не принят");
    // Новый чек принимается и снова ждёт продавца; его тоже можно отклонить.
    expect((await attachBalanceProof(ctx(), order(), jpeg(6)))?.ok).toBe(true);
    expect(await balancePayable(ctx(), order())).toBe(0);
    expect(await rejectBalanceProof(ctx(), 7, "admin:anna")).toBe(true);
    expect(await balancePayable(ctx(), order())).toBe(7000);
  });

  it("переплата не записывается — событие для продавца", async () => {
    order().paid_amount = 9000;
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "refused",
    );
    expect(order().paid_amount).toBe(9000);
    const events = await listOrderEvents(ctx(), 7);
    expect(events.map((e) => e.kind)).toEqual(["balance_paid", "balance_overpaid"]);
    expect(describeOrderEvent(events[1]!)).toMatchObject({ tone: "danger" });
    expect((await recordBalancePaidOnline(ctx(), 8, 1, "Robokassa", "inv")).result).toBe(
      "not_found",
    );
  });

  it("метка оплаты не записалась (сбой базы) — не «повтор»: шлюз повторит, деньги не теряются", async () => {
    const origFrom = db.from.bind(db);
    db.from = ((t: string) => {
      const q = origFrom(t);
      if (t !== "zernio_logs") return q;
      q.insert = (() =>
        Promise.resolve({
          data: null,
          error: { code: "57014", message: "timeout" },
        })) as unknown as typeof q.insert;
      return q;
    }) as typeof db.from;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "retry",
    );
    expect(order().paid_amount).toBe(3000);
  });

  it("оплата остатка по отменённому заказу: не «оплачено», событие и продавцу — решить или вернуть", async () => {
    order().status = "cancelled";
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "closed",
    );
    expect(order().paid_amount).toBe(3000);
    const events = await listOrderEvents(ctx(), 7);
    expect(events.map((e) => e.kind)).toEqual(["balance_paid", "balance_closed"]);
    expect(describeOrderEvent(events[0]!)).toMatchObject({ tone: "neutral" });
    expect(describeOrderEvent(events[1]!)).toMatchObject({ tone: "danger" });
    expect(describeOrderEvent(events[1]!).text).toContain("счёт №inv");
  });

  it("запись оплаты не прошла (сбой, не переплата) — метка снята, повтор колбэка записывает", async () => {
    const origFrom = db.from.bind(db);
    let failOrders = true;
    db.from = ((t: string) => {
      const q = origFrom(t);
      if (t !== "orders" || !failOrders) return q;
      const update = q.update.bind(q);
      // CAS paid_amount проигрывается все пять раз.
      q.update = ((v: Record<string, unknown>) =>
        "paid_amount" in v ? update({ ...v }).eq("id", -1) : update(v)) as typeof q.update;
      return q;
    }) as typeof db.from;
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "retry",
    );
    expect(order().paid_amount).toBe(3000);
    expect((await listOrderEvents(ctx(), 7)).map((e) => e.kind)).toEqual([]);
    failOrders = false;
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv")).result).toBe(
      "recorded",
    );
    expect(order().paid_amount).toBe(10000);
  });

  it("карта и чек одновременно: остаток записан один раз, чек больше не ждёт, продавцу — предупреждение", async () => {
    const [proof, paid] = await Promise.all([
      attachBalanceProof(ctx(), { ...order() }, jpeg(9)),
      recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv"),
    ]);
    expect(paid.result).toBe("recorded");
    expect(order().paid_amount).toBe(10000);
    expect(await balancePayable(ctx(), order())).toBe(0);
    // Чек принят раньше записи оплаты — продавца предупредили не вносить его;
    // пришёл позже — уже не нужен (остатка нет).
    if (proof?.ok) expect(paid.proofPending).toBe(true);
    else expect(proof).toBeNull();
    // Внести чек повторно нельзя: переплата не записывается.
    order().status = "ready";
    expect((await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv2")).result).toBe(
      "refused",
    );
    expect(order().paid_amount).toBe(10000);
  });

  it("чек ждал продавца, пришла оплата картой — продавцу пометка о чеке", async () => {
    expect((await attachBalanceProof(ctx(), order(), jpeg(10)))?.ok).toBe(true);
    const r = await recordBalancePaidOnline(ctx(), 7, 7000, "Robokassa", "inv");
    expect(r).toEqual({ result: "recorded", proofPending: true });
  });
});
