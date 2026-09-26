import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Счета владельцам за подписку (billing.server) на базе в памяти:
 * реквизиты, выставление, подтверждение с откатом, отмена, ссылка на чек.
 * Живые проверки на демо-клиенте — tests/integration/billing.test.ts.
 */
let base: FakeDb;
let failPayment = false;
const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
const toOwner: string[] = [];
let ownerDelivered = true;

function wrap(b: FakeDb): FakeDb {
  return {
    ...b,
    from: (table: string) => {
      const q = b.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (table === "subscription_invoices") {
        // Значения по умолчанию, как в схеме.
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
      if (table === "subscription_payments" && failPayment)
        q.insert = () => Promise.resolve({ data: null, error: { message: "сбой базы" } });
      return q as never;
    },
  };
}

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    ...wrap(base),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number) => ({
          data: { signedUrl: `https://s.test/${path}?ttl=${ttl}` },
          error: null,
        }),
      }),
    },
  }),
}));
vi.mock("./operator.server", () => ({
  logEvent: async (_bot: string, kind: string, payload: Record<string, unknown> = {}) => {
    events.push({ kind, payload });
  },
  notifyOwner: async (_bot: string, text: string) => {
    toOwner.push(text);
    return ownerDelivered
      ? { delivered: ["owner"], failed: [] }
      : { delivered: [], failed: [{ id: "owner", reason: "бот заблокирован" }] };
  },
}));
let hookFails = false;
vi.mock("./plans.server", () => ({
  onInvoicePaid: async () => {
    if (hookFails) throw new Error("сбой подключения");
  },
}));

const billing = await import("./billing.server");
const BOT = "00000000-0000-0000-0000-0000000000b1";
const PERIOD = { start: "2026-10-01", end: "2026-10-31" };
const actions = () => events.map((e) => e.payload.action);
const inv = (id: string) => base.tables.subscription_invoices!.find((r) => r.id === id)!;

beforeEach(() => {
  base = fakeDb();
  base.tables.operator_settings = [];
  base.tables.subscription_invoices = [];
  base.tables.subscription_payments = [];
  base.tables.bots = [{ id: BOT, status: "active", subscription_expires_at: null }];
  failPayment = false;
  hookFails = false;
  ownerDelivered = true;
  events.length = 0;
  toOwner.length = 0;
});

async function withRequisites() {
  await billing.setPayoutRequisites("Kaspi Gold 4400 0000 0000 0000, Иван И.");
}

describe("счета за подписку", () => {
  it("пустые реквизиты по умолчанию, сохраняются и читаются обратно", async () => {
    expect(await billing.getPayoutRequisites()).toBe("");
    await billing.setPayoutRequisites("  Kaspi Gold 4400  ");
    expect(await billing.getPayoutRequisites()).toBe("Kaspi Gold 4400");
    // Повторное сохранение обновляет ту же строку, а не заводит вторую.
    await billing.setPayoutRequisites("Halyk 5500");
    expect(await billing.getPayoutRequisites()).toBe("Halyk 5500");
    expect(base.tables.operator_settings).toHaveLength(1);
  });

  it("отказывает, если реквизиты не заданы", async () => {
    await expect(
      billing.createInvoice(BOT, { amount: 9900, currency: "KZT", note: null }, "operator"),
    ).rejects.toThrow(/Реквизиты|Ссылка Kaspi/);
    expect(base.tables.subscription_invoices).toEqual([]);
    expect(toOwner).toEqual([]);
  });

  it("заводит счёт, отправляет текст владельцу через callInternal, пишет журнал", async () => {
    await withRequisites();
    const r = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: "План Basic" },
      "operator",
    );
    expect(r.delivered).toBe(true);
    expect(r.invoice).toMatchObject({
      bot_id: BOT,
      amount: 9900,
      status: "sent",
      has_proof: false,
    });
    expect(r.invoice.requisites_snapshot).toContain("Kaspi Gold 4400");
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]).toContain("9900 KZT");
    expect(toOwner[0]).toContain("Kaspi Gold 4400");
    expect(events[0]).toMatchObject({
      kind: "payment",
      payload: { action: "invoice_created", invoice_id: r.invoice.id, pay_provider: "transfer" },
    });
  });

  it("недоставленный счёт остаётся в базе, причина возвращается", async () => {
    await withRequisites();
    ownerDelivered = false;
    const r = await billing.createInvoice(BOT, { amount: 9900, currency: "KZT", note: null }, "op");
    expect(r).toMatchObject({ delivered: false, deliveryError: "бот заблокирован" });
    expect(inv(r.invoice.id).status).toBe("sent");
  });

  it("если addPayment падает — статус откатывается, счёт остаётся подтверждаемым", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    inv(invoice.id).status = "proof_uploaded";
    failPayment = true;
    await expect(billing.confirmInvoice(invoice.id, PERIOD, "op")).rejects.toThrow(/платёж/);
    expect(inv(invoice.id)).toMatchObject({ status: "proof_uploaded", confirmed_at: null });
    // Сбой прошёл — тот же счёт подтверждается.
    failPayment = false;
    await billing.confirmInvoice(invoice.id, PERIOD, "op");
    expect(inv(invoice.id).status).toBe("paid");
    expect(base.tables.subscription_payments).toHaveLength(1);
  });

  it("двойное подтверждение подряд не задваивает addPayment", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    const both = await Promise.allSettled([
      billing.confirmInvoice(invoice.id, PERIOD, "op"),
      billing.confirmInvoice(invoice.id, PERIOD, "op"),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(billing.confirmInvoice(invoice.id, PERIOD, "op")).rejects.toThrow(/paid/);
    expect(base.tables.subscription_payments).toHaveLength(1);
    expect(base.tables.subscription_payments![0]).toMatchObject({
      bot_id: BOT,
      amount: 9900,
      period_end: PERIOD.end,
    });
    expect(actions().filter((a) => a === "invoice_confirmed")).toHaveLength(1);
  });

  it("отменить можно только счёт без присланного чека", async () => {
    await withRequisites();
    const make = async () =>
      (await billing.createInvoice(BOT, { amount: 9900, currency: "KZT", note: null }, "op"))
        .invoice.id;
    const fresh = await make();
    await billing.cancelInvoice(fresh, "op");
    expect(inv(fresh).status).toBe("cancelled");

    const withProof = await make();
    inv(withProof).status = "proof_uploaded";
    await expect(billing.cancelInvoice(withProof, "op")).rejects.toThrow(/не прислали чек/);
    expect(inv(withProof).status).toBe("proof_uploaded");

    const paid = await make();
    await billing.confirmInvoice(paid, PERIOD, "op");
    await expect(billing.cancelInvoice(paid, "op")).rejects.toThrow();
    expect(inv(paid).status).toBe("paid");
  });

  it("отмена одновременно с подтверждением не затирает оплаченный счёт", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    const [confirmed, cancelled] = await Promise.allSettled([
      billing.confirmInvoice(invoice.id, PERIOD, "op"),
      billing.cancelInvoice(invoice.id, "op"),
    ]);
    expect(confirmed.status).toBe("fulfilled");
    expect(cancelled.status).toBe("rejected");
    expect(inv(invoice.id).status).toBe("paid");
    // И отклонение не затирает оплаченный.
    await expect(billing.rejectInvoice(invoice.id, "нет", "op")).rejects.toThrow(/оплачен/);
    expect(inv(invoice.id).status).toBe("paid");
  });

  it("отклонение одновременно с подтверждением не затирает оплаченный счёт", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    inv(invoice.id).status = "proof_uploaded";
    const [confirmed] = await Promise.allSettled([
      billing.confirmInvoice(invoice.id, PERIOD, "op"),
      billing.rejectInvoice(invoice.id, "не тот чек", "op"),
    ]);
    if (confirmed.status === "fulfilled") expect(inv(invoice.id).status).toBe("paid");
    expect(base.tables.subscription_payments!.length).toBe(
      inv(invoice.id).status === "paid" ? 1 : 0,
    );
  });

  it("сбой после записи платежа не откатывает оплаченный счёт", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    hookFails = true;
    await billing.confirmInvoice(invoice.id, PERIOD, "op");
    expect(inv(invoice.id).status).toBe("paid");
    expect(base.tables.subscription_payments).toHaveLength(1);
    expect(actions()).toContain("invoice_paid_hook_failed");
    // Повторное подтверждение не пишет второй платёж.
    await expect(billing.confirmInvoice(invoice.id, PERIOD, "op")).rejects.toThrow();
    expect(base.tables.subscription_payments).toHaveLength(1);
  });

  it("отклонить можно только ждущий счёт: отменённый и отклонённый — нет", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    await billing.cancelInvoice(invoice.id, "op");
    await expect(billing.rejectInvoice(invoice.id, "нет", "op")).rejects.toThrow(/cancelled/);
    expect(inv(invoice.id).status).toBe("cancelled");
  });

  it("null, пока чек не прислан; signed URL, когда путь есть", async () => {
    await withRequisites();
    const { invoice } = await billing.createInvoice(
      BOT,
      { amount: 9900, currency: "KZT", note: null },
      "op",
    );
    expect(await billing.invoiceProofUrl(invoice.id)).toBeNull();
    inv(invoice.id).proof_path = `${BOT}/invoice-1.jpg`;
    // Ссылка короткая — оператору на просмотр, не для пересылки.
    expect(await billing.invoiceProofUrl(invoice.id)).toBe(
      `https://s.test/${BOT}/invoice-1.jpg?ttl=300`,
    );
  });
});
