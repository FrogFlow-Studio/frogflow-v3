import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { markProofVerified } from "./orders";
import { paymentsCsv } from "@/core/export/payments";

/** Автопроверка чека: «оплачено» оставляет платёж в журнале с настоящей суммой чека. */
let db: FakeDb;
const BOT = "shop-1";
const ctx = () =>
  ({ tenant: { id: BOT, modules: {} }, db, timezone: "Asia/Almaty" }) as unknown as TenantContext;
const payments = () => db.tables.zernio_logs!.filter((e) => e.event_type === "order.payment");

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [
    {
      id: 7,
      bot_id: BOT,
      order_no: 7,
      display_no: 7,
      status: "awaiting_confirmation",
      fulfillment_kind: "digital",
      payment_proof_hash: "h1",
      payment_proof_path: "proofs/7.jpg",
      total: 10000,
      paid_amount: 0,
      currency: "KZT",
      platform: "telegram",
      created_at: new Date().toISOString(),
    },
  ];
  db.tables.zernio_logs = [];
});

describe("markProofVerified пишет платёж", () => {
  it("чек на +29 %: событие с суммой чека, переплата отдельным полем, оплачено — не больше заказа", async () => {
    expect(await markProofVerified(ctx(), 7, "h1", "OCR ok", { amount: 12900 })).toBe(true);
    expect(db.tables.orders![0]).toMatchObject({ status: "paid", paid_amount: 10000 });
    expect(payments()).toHaveLength(1);
    expect(payments()[0]!.payload).toMatchObject({
      order_id: 7,
      amount: 12900,
      currency: "KZT",
      source: "receipt",
      overpaid: 2900,
    });
  });

  it("точная сумма — без переплаты", async () => {
    await markProofVerified(ctx(), 7, "h1", "OCR ok", { amount: 10000 });
    expect(payments()[0]!.payload).not.toHaveProperty("overpaid");
  });

  it("был задаток: переплата считается с учётом уже внесённого", async () => {
    db.tables.orders![0]!.paid_amount = 3000;
    await markProofVerified(ctx(), 7, "h1", "OCR ok", { amount: 8000 });
    expect(db.tables.orders![0]).toMatchObject({ paid_amount: 10000 });
    expect(payments()[0]!.payload).toMatchObject({ amount: 8000, overpaid: 1000 });
  });

  it("чек в другой валюте (по курсу): сумма и валюта чека, заказ оплачен целиком", async () => {
    await markProofVerified(ctx(), 7, "h1", "OCR ok", { amount: 20, currency: "USD" });
    expect(db.tables.orders![0]).toMatchObject({ status: "paid", paid_amount: 10000 });
    expect(payments()[0]!.payload).toMatchObject({ amount: 20, currency: "USD" });
    expect(payments()[0]!.payload).not.toHaveProperty("overpaid");
  });

  it("чек сменили, пока шла проверка — ни оплаты, ни события", async () => {
    expect(await markProofVerified(ctx(), 7, "другой", "OCR ok", { amount: 10000 })).toBe(false);
    expect(db.tables.orders![0]).toMatchObject({ status: "awaiting_confirmation", paid_amount: 0 });
    expect(payments()).toHaveLength(0);
  });

  it("выгрузка «Оплаты» берёт сумму чека, даже если выдача не прошла", async () => {
    await markProofVerified(ctx(), 7, "h1", "OCR ok", { amount: 12900 });
    // Выдачи нет (язык не выбран, сбой отправки) — раньше платежа в выгрузке не было.
    const { csv, count } = await paymentsCsv(ctx());
    expect(count).toBe(1);
    expect(csv).toContain("12900");
    expect(csv).toContain("перевод по чеку");
  });
});
