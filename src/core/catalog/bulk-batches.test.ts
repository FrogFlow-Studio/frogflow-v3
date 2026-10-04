import { describe, expect, it } from "vitest";
import { BULK_MAX } from "./bulk";
import { BULK_BATCH, runBulkInBatches, type BulkSummary } from "./bulk-batches";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);
const ok = (b: string[]): BulkSummary => ({ changed: b.length, skipped: [], stock: [] });

describe("массовое действие пачками", () => {
  it("размер пачки равен лимиту сервера", () => {
    expect(BULK_BATCH).toBe(BULK_MAX);
  });
  it("«все по фильтру» больше страницы и больше лимита: ничего не теряется", async () => {
    const seen: number[] = [];
    const r = await runBulkInBatches(ids(1203), async (b) => {
      seen.push(b.length);
      return ok(b);
    });
    expect(seen).toEqual([500, 500, 203]);
    expect(r.changed).toBe(1203);
    expect(r.processed).toBe(1203);
    expect(r.error).toBeNull();
  });
  it("пропущенные и остатки складываются из всех пачек", async () => {
    const r = await runBulkInBatches(
      ids(7),
      async (b) => ({
        changed: b.length - 1,
        skipped: [{ id: b[0]!, name: "x", reason: "same" }],
        stock: [{ id: b[1]!, name: "y", from: 1, to: 2 }],
      }),
      3,
    );
    expect(r.changed).toBe(4);
    expect(r.skipped.map((s) => s.id)).toEqual(["id0", "id3", "id6"]);
    expect(r.stock).toHaveLength(3);
  });
  it("сбой пачки останавливает работу и честно считает обработанное", async () => {
    let calls = 0;
    const r = await runBulkInBatches(
      ids(10),
      async (b) => {
        calls += 1;
        if (calls === 2) throw new Error("boom");
        return ok(b);
      },
      4,
    );
    expect(r.processed).toBe(4);
    expect(r.changed).toBe(4);
    expect(r.error).toBeInstanceOf(Error);
    expect(calls).toBe(2);
  });
  it("пустой выбор — ни одного вызова", async () => {
    let calls = 0;
    await runBulkInBatches([], async (b) => {
      calls += 1;
      return ok(b);
    });
    expect(calls).toBe(0);
  });
});
