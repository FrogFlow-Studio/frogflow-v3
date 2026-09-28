import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OpenInvoice } from "./invoices";

/**
 * Чек владельца при нескольких открытых счетах (подписка и пополнение
 * ИИ-баланса): засчитывается только тому счёту, с которым сходится ровно он
 * один; иначе ложится на старейший и ждёт оператора.
 */
let base: FakeDb;
let receipt = "";
const reads = vi.fn(async () => receipt);
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => base }));
vi.mock("@/core/receipts/verify.server", () => ({ readReceiptText: () => reads() }));

const { pickInvoiceForReceipt, verifyInvoiceProof, SEVERAL_INVOICES } =
  await import("./invoice-check.server");
const { openInvoicesForOwner } = await import("./invoices");

const kaspi = (sum: string) =>
  `Kaspi.kz\nПеревод успешно совершен\n${sum}\nПолучатель Яков В.\nДата и время 28.09.2026 13:51\nКвитанция № 7654321`;
const inv = (id: string, amount: number, day: string): OpenInvoice => ({
  id,
  amount,
  currency: "KZT",
  note: null,
  created_at: `2026-09-${day}T10:00:00Z`,
});
const SUB = inv("sub", 9900, "26");
const TOPUP = inv("topup", 5000, "27");
const file = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" };
const ctx = {} as TenantContext;

beforeEach(() => {
  base = fakeDb();
  base.tables.operator_settings = [{ key: "payout_receipt_recipient", value: "Яков В." }];
  base.tables.bot_events = [];
  reads.mockClear();
});

describe("чек при нескольких открытых счетах", () => {
  it("чек на сумму пополнения — к счёту пополнения, текст читается один раз", async () => {
    receipt = kaspi("5 000 ₸");
    const pick = await pickInvoiceForReceipt(ctx, [SUB, TOPUP], file);
    expect(pick.invoice.id).toBe("topup");
    expect(pick.manual).toBeUndefined();
    const { invoice, ...pre } = pick;
    const check = await verifyInvoiceProof(ctx, invoice, file, pre);
    expect(check).toMatchObject({ ok: true, operationId: "7654321" });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("чек не сходится ни с одним — к старейшему, проверяет оператор", async () => {
    receipt = kaspi("7 000 ₸");
    const pick = await pickInvoiceForReceipt(ctx, [SUB, TOPUP], file);
    expect(pick).toMatchObject({ invoice: { id: "sub" }, manual: SEVERAL_INVOICES });
    const { invoice, ...pre } = pick;
    expect(await verifyInvoiceProof(ctx, invoice, file, pre)).toMatchObject({
      ok: false,
      detail: SEVERAL_INVOICES,
    });
  });

  it("два счёта на одну сумму — чек не засчитывается сам", async () => {
    receipt = kaspi("9 900 ₸");
    const pick = await pickInvoiceForReceipt(ctx, [SUB, inv("sub2", 9900, "27")], file);
    expect(pick.manual).toBe(SEVERAL_INVOICES);
  });

  it("один счёт — без предварительного чтения, обычная проверка", async () => {
    receipt = kaspi("9 900 ₸");
    const pick = await pickInvoiceForReceipt(ctx, [SUB], file);
    expect(pick).toEqual({ invoice: SUB });
    expect(reads).not.toHaveBeenCalled();
  });

  it("сбой чтения открытых счетов — ошибка, а не «счетов нет»", async () => {
    const broken = {
      tenant: { id: "b", ownerTelegramId: 42 },
      db: {
        from: () => {
          const c: unknown = new Proxy(
            {},
            {
              get: (_, k) =>
                k === "then"
                  ? (res: (v: unknown) => unknown) =>
                      res({ data: null, error: { message: "boom" } })
                  : () => c,
            },
          );
          return c;
        },
      },
    } as unknown as TenantContext;
    await expect(openInvoicesForOwner(broken, 42)).rejects.toThrow(/boom/);
    expect(await openInvoicesForOwner(broken, 43)).toEqual([]);
  });
});
