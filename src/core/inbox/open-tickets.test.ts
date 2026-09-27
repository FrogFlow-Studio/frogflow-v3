import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { OPEN_TICKET_DB_STATUSES, TICKET_PREFIX } from "@/core/helpdesk/tickets";
import { openTicketNumbers } from "./inbox";

/**
 * Значок обращений в списке диалогов: раньше читались только первые 500
 * открытых, у покупателя с поздним обращением значка не было.
 */
describe("openTicketNumbers", () => {
  it("открытых обращений больше 500 и больше страницы — значок есть и у позднего", async () => {
    const db = fakeDb({ maxRows: 1000 });
    const status = OPEN_TICKET_DB_STATUSES[0];
    db.tables.zernio_logs = Array.from({ length: 1200 }, (_, i) => ({
      id: `t-${String(i).padStart(5, "0")}`,
      event_id: `${TICKET_PREFIX}${i}`,
      status,
      created_at: "2026-09-27T00:00:00Z",
      payload: { telegram_id: i === 1199 ? 42 : 1000 + i, number: i + 1 },
    }));
    const ctx = { tenant: { id: "bot" }, db } as unknown as TenantContext;
    const map = await openTicketNumbers(ctx, [42, 1000]);
    expect(map.get(42)).toEqual([1200]);
    expect(map.get(1000)).toEqual([1]);
  });
});
