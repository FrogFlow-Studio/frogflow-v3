import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listGiftCertificates, listPromoCodes } from "./lists";

/**
 * Списки промокодов и сертификатов в админке — целиком: раньше обрезались
 * на 300 без предупреждения, у продавца с рассылкой сертификатов старые
 * пропадали из списка.
 */
function setup(table: "promo_codes" | "gift_certificates", n: number) {
  const db = fakeDb({ maxRows: 1000 });
  // Одинаковое время создания у всех: порядок держит второй ключ (id).
  db.tables[table] = Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, "0")}`,
    code: `C${i}`,
    created_at: i < n - 1 ? "2026-09-01T00:00:00Z" : "2026-09-27T00:00:00Z",
  }));
  return { tenant: { id: "bot" }, db } as unknown as TenantContext;
}

describe("списки промокодов и сертификатов", () => {
  it("промокодов больше 300 и больше страницы PostgREST — приходят все, новые сверху", async () => {
    const rows = await listPromoCodes(setup("promo_codes", 1500));
    expect(rows).toHaveLength(1500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1500);
    expect(rows[0]!.code).toBe("C1499");
  });

  it("сертификатов больше 300 — приходят все", async () => {
    const rows = await listGiftCertificates(setup("gift_certificates", 1200));
    expect(rows).toHaveLength(1200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1200);
  });
});
