import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listOrderEvents, ORDER_EVENT_STATUS } from "./events";

/** История заказа не обрезается и не путается при одинаковом created_at. */
describe("listOrderEvents", () => {
  it("1500 событий в одну секунду — приходят все, в порядке id, чужие заказы не попадают", async () => {
    const db = fakeDb({ maxRows: 1000 });
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    db.tables.zernio_logs = Array.from({ length: 1500 }, (_, i) => ({
      id: id(i + 1),
      created_at: "2026-10-03T10:00:00Z",
      event_type: "order.status",
      status: ORDER_EVENT_STATUS,
      payload: { order_id: i === 700 ? 8 : 7, actor: "bot" },
    }));
    // Строки лежат в базе вперемешку: порядок обязан задавать запрос.
    db.tables.zernio_logs.reverse();
    const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
    const events = await listOrderEvents(ctx, 7);
    expect(events).toHaveLength(1499);
    expect(new Set(events.map((e) => e.id)).size).toBe(1499);
    expect(events.map((e) => e.id)).toEqual(events.map((e) => e.id).sort());
  });
});
