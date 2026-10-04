import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Отметок чека больше страницы: отметка другого счёта в конце списка не теряется. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { claimReceipt } = await import("./invoice-check.server");
const { operationKey } = await import("./invoice-check");

const mark = (n: number, invoiceId: string, extra: Record<string, unknown>) => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  kind: "payment",
  bot_id: null,
  at: "2026-10-04T10:00:00Z",
  actor: "t",
  payload: { action: "invoice_proof", invoice_id: invoiceId, ...extra },
});

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
});

describe("claimReceipt: больше 1000 отметок", () => {
  it("чужая отметка с тем же файлом за пределами первой страницы всё равно видна", async () => {
    const same = Array.from({ length: 1100 }, (_, i) => mark(i + 1, "inv-a", { proof_hash: "h" }));
    db.tables.bot_events = [...same, mark(5000, "inv-b", { proof_hash: "h" })];
    const r = await claimReceipt("inv-a", { hash: "h", operationId: "1234567" });
    expect(r).toMatch(/уже присылали по другому счёту/);
  });

  it("отметки только этого счёта: чек за ним, но без отметки операции — «не записалась»", async () => {
    db.tables.bot_events = Array.from({ length: 1100 }, (_, i) =>
      mark(i + 1, "inv-a", { proof_hash: "h", receipt_op_key: operationKey("1234567") }),
    );
    expect(await claimReceipt("inv-a", { hash: "h", operationId: "1234567" })).toBeNull();
  });
});
