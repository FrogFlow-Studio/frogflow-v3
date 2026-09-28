import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Пополнение ИИ-баланса продавцом: счёт в тенге по курсу через обычный путь
 * счетов владельцу, метка суммы в долларах, зачисление при подтверждении
 * вместо продления подписки — ровно один раз.
 */
let base: FakeDb;
let failMark = false;
let failBalance = false;
let failMarkRead = false;
let failRollback = false;
const errChain = (): unknown => {
  const c: unknown = new Proxy(
    {},
    {
      get: (_, k) =>
        k === "then"
          ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: "boom" } })
          : () => c,
    },
  );
  return c;
};
const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
const toOwner: string[] = [];
const BOT = "00000000-0000-0000-0000-0000000000b1";

function wrap(b: FakeDb): FakeDb {
  return {
    ...b,
    from: (table: string) => {
      const q = b.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (table === "subscription_invoices") {
        const insert = q.insert!.bind(q);
        q.insert = (r) =>
          insert({
            status: "sent",
            proof_path: null,
            proof_uploaded_at: null,
            confirmed_at: null,
            reject_reason: null,
            created_at: new Date().toISOString(),
            ...(r as object),
          });
      }
      if (table === "app_settings" && failMark) {
        const insert = q.insert!.bind(q);
        q.insert = (r) =>
          String((r as { key?: string }).key).startsWith("ai_topup:")
            ? Promise.resolve({ data: null, error: { message: "сбой базы" } })
            : insert(r);
      }
      if (table === "app_settings" && failMarkRead) q.in = () => errChain();
      if (table === "subscription_invoices" && failRollback) {
        const update = q.update!.bind(q);
        q.update = (r) => ((r as { status?: string }).status === "paid" ? update(r) : errChain());
      }
      if (table === "app_settings" && failBalance) {
        // Любое изменение баланса отвечает ошибкой базы.
        const err: unknown = new Proxy(
          {},
          {
            get: (_, k) =>
              k === "then"
                ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: "boom" } })
                : () => err,
          },
        );
        q.update = () => err;
      }
      return q as never;
    },
  };
}

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => wrap(base) }));
vi.mock("./operator.server", () => ({
  logEvent: async (_bot: string, kind: string, payload: Record<string, unknown> = {}) => {
    events.push({ kind, payload });
  },
  notifyOwner: async (_bot: string, text: string) => {
    toOwner.push(text);
    return { delivered: ["owner"], failed: [] };
  },
}));
vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("./plans.server", () => ({ onInvoicePaid: async () => {} }));
vi.mock("@/core/pricing/pricing", () => ({
  convertForTenant: async (amount: number) => Math.round(amount * 500),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => ({ id: BOT, settings: {}, modules: {}, ownerTelegramId: 42 }),
  tenantContext: (tenant: unknown) => ({ tenant, db: wrap(base) }),
}));

const billing = await import("./billing.server");
const topup = await import("./ai-topup.server");
const PERIOD = { start: "2026-10-01", end: "2026-10-31" };
const balance = () =>
  JSON.parse(String(base.tables.app_settings!.find((r) => r.key === "ai_balance")?.value ?? "{}"))
    .usd as number | undefined;

beforeEach(async () => {
  base = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  base.tables.operator_settings = [];
  base.tables.subscription_invoices = [];
  base.tables.subscription_payments = [];
  base.tables.app_settings = [];
  base.tables.zernio_logs = [];
  base.tables.bots = [{ id: BOT, status: "active", subscription_expires_at: null }];
  failMark = false;
  failBalance = false;
  failMarkRead = false;
  failRollback = false;
  events.length = 0;
  toOwner.length = 0;
  await billing.setPayoutRequisites("Kaspi Gold 4400, Иван И.");
});

describe("пополнение ИИ-баланса счётом", () => {
  it("счёт в тенге по курсу, метка в долларах, владелец получает счёт", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    expect(r).toMatchObject({ usd: 10, amount: 5000, currency: "KZT", reused: false });
    expect(r.note).toBe("Пополнение ИИ-баланса на 10 $");
    expect(toOwner[0]).toContain("5000 KZT");
    const marks = await topup.aiTopupMarks(BOT, [r.invoiceId]);
    expect(marks.get(r.invoiceId)).toEqual({ usd: 10, kzt: 5000 });
  });

  it("повторное нажатие — тот же счёт; другая сумма — прежний отменяется", async () => {
    const a = await topup.createAiTopup(BOT, 10, "admin:owner");
    const again = await topup.createAiTopup(BOT, 10, "admin:owner");
    expect(again).toMatchObject({ invoiceId: a.invoiceId, reused: true });
    const b = await topup.createAiTopup(BOT, 20, "admin:owner");
    expect(b.invoiceId).not.toBe(a.invoiceId);
    const status = (id: string) =>
      base.tables.subscription_invoices!.find((r) => r.id === id)!.status;
    expect(status(a.invoiceId)).toBe("cancelled");
    expect(status(b.invoiceId)).toBe("sent");
  });

  it("сумма вне 5–500 $ — отказ, счёта нет", async () => {
    await expect(topup.createAiTopup(BOT, 4, "admin:owner")).rejects.toThrow(/от 5 до 500/);
    await expect(topup.createAiTopup(BOT, 501, "admin:owner")).rejects.toThrow(/от 5 до 500/);
    expect(base.tables.subscription_invoices).toEqual([]);
  });

  it("метка не записалась — счёт отменён и владельцу не ушёл", async () => {
    failMark = true;
    await expect(topup.createAiTopup(BOT, 10, "admin:owner")).rejects.toThrow(/метить/);
    expect(base.tables.subscription_invoices!.map((r) => r.status)).toEqual(["cancelled"]);
    expect(toOwner).toEqual([]);
  });

  it("подтверждение зачисляет доллары один раз и не продлевает подписку", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    const out = await billing.confirmInvoice(r.invoiceId, PERIOD, "auto-check");
    expect(out).toEqual({ expiresAt: null });
    // Стартовые 5 $ при первом обращении плюс пополнение.
    expect(balance()).toBe(15);
    expect(base.tables.subscription_payments).toEqual([]);
    const ledger = base.tables
      .app_settings!.filter((s) => String(s.key).startsWith("ai_ledger:"))
      .map((s) => JSON.parse(String(s.value)));
    expect(ledger.find((e) => e.kind === "topup")).toMatchObject({
      usd: 10,
      invoiceId: r.invoiceId,
      note: `Счёт ${r.invoiceId.slice(0, 8)} на 5000 ₸`,
    });
    expect(events.at(-1)).toMatchObject({
      payload: { action: "invoice_confirmed", invoice_id: r.invoiceId, ai_topup_usd: 10 },
    });
    await expect(billing.confirmInvoice(r.invoiceId, PERIOD, "op")).rejects.toThrow(/уже/);
    expect(balance()).toBe(15);
  });

  it("зачисление сорвалось — счёт оплачен, сбой в журнале, «Зачислить повторно» начисляет один раз", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    base.tables.app_settings!.push({
      bot_id: BOT,
      key: "ai_balance",
      value: JSON.stringify({ usd: 5, low: false, empty: false }),
    });
    failBalance = true;
    const err = await billing
      .confirmInvoice(r.invoiceId, PERIOD, "auto-check", "QR123456789")
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/Зачислить повторно/);
    expect(base.tables.subscription_invoices![0]!.status).toBe("paid");
    expect(events.at(-1)).toMatchObject({
      payload: {
        action: "ai_topup_failed",
        invoice_id: r.invoiceId,
        amount: 5000,
        currency: "KZT",
        usd: 10,
        receipt_op: "QR123456789",
      },
    });
    expect(balance()).toBe(5);
    expect(await topup.uncreditedAiTopups(BOT, [r.invoiceId])).toEqual([r.invoiceId]);

    failBalance = false;
    expect((await topup.recreditAiTopup(r.invoiceId, "op")).usd).toBe(15);
    await expect(topup.recreditAiTopup(r.invoiceId, "op")).rejects.toThrow(/Уже зачислено/);
    expect(balance()).toBe(15);
    expect(await topup.uncreditedAiTopups(BOT, [r.invoiceId])).toEqual([]);
    const ledger = base.tables.app_settings!.filter((s) => String(s.key).startsWith("ai_ledger:"));
    expect(ledger).toHaveLength(1);
  });

  it("баланс изменился, а журнал не записался — повтор дописывает журнал, не начисляя", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    await billing.confirmInvoice(r.invoiceId, PERIOD, "op");
    expect(balance()).toBe(15);
    base.tables.app_settings = base.tables.app_settings!.filter(
      (s) => !String(s.key).startsWith("ai_ledger:") || !String(s.value).includes("topup"),
    );
    expect(await topup.uncreditedAiTopups(BOT, [r.invoiceId])).toEqual([r.invoiceId]);
    await topup.recreditAiTopup(r.invoiceId, "op");
    expect(balance()).toBe(15);
    expect(await topup.uncreditedAiTopups(BOT, [r.invoiceId])).toEqual([]);
  });

  it("счёт давно вытеснен из памяти баланса, а в журнале есть — повтор не начисляет", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    await billing.confirmInvoice(r.invoiceId, PERIOD, "op");
    const row = base.tables.app_settings!.find((s) => s.key === "ai_balance")!;
    row.value = JSON.stringify({ ...JSON.parse(String(row.value)), topups: [] });
    await expect(topup.recreditAiTopup(r.invoiceId, "op")).rejects.toThrow(/Уже зачислено/);
    expect(balance()).toBe(15);
    expect(events.some((e) => e.payload.action === "ai_topup_recredited")).toBe(false);
  });

  it("метка не прочиталась и откат не записался — «оплачен без платежа» в журнале", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    failMarkRead = true;
    failRollback = true;
    await expect(billing.confirmInvoice(r.invoiceId, PERIOD, "op")).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({
      payload: { action: "invoice_paid_without_payment", invoice_id: r.invoiceId },
    });
    failRollback = false;
    failMarkRead = false;
  });

  it("метка не прочиталась — счёт вернулся в прежний статус", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    failMarkRead = true;
    await expect(billing.confirmInvoice(r.invoiceId, PERIOD, "op")).rejects.toThrow();
    expect(base.tables.subscription_invoices![0]!.status).toBe("sent");
    expect(events.some((e) => e.payload.action === "invoice_paid_without_payment")).toBe(false);
  });

  it("зачислить повторно можно только оплаченный счёт пополнения", async () => {
    const r = await topup.createAiTopup(BOT, 10, "admin:owner");
    await expect(topup.recreditAiTopup(r.invoiceId, "op")).rejects.toThrow(/оплаченный/);
  });

  it("счёт за подписку по-прежнему продлевает подписку, баланс не трогает", async () => {
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: "План Basic" },
      "op",
    );
    await billing.confirmInvoice(invoice.id, PERIOD, "op");
    expect(base.tables.subscription_payments).toHaveLength(1);
    expect(balance()).toBeUndefined();
  });

  it("открытые счета подписки — без пополнений", async () => {
    const t = await topup.createAiTopup(BOT, 10, "admin:owner");
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    const rows = [{ id: t.invoiceId }, { id: invoice.id }];
    expect(await topup.openSubscriptionInvoices(BOT, rows)).toEqual([{ id: invoice.id }]);
  });
});
