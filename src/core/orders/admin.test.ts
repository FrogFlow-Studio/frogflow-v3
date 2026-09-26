import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { PHYSICAL_NEXT, setPhysicalStatus } from "./admin";

const BOT = "00000000-0000-0000-0000-000000000001";

function setup(status: string) {
  const db = fakeDb();
  db.tables.orders = [{ id: 1, bot_id: BOT, status, fulfillment_kind: "physical" }];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { ctx, order: () => db.tables.orders![0]! };
}

/** Шаг «дальше» так, как его делает админка: следующий статус и CAS по текущему. */
async function advance(ctx: TenantContext, status: () => string): Promise<string | null> {
  const from = status();
  const to = PHYSICAL_NEXT[from];
  if (!to) return null;
  return (await setPhysicalStatus(ctx, 1, from, to)) ? to : null;
}

describe("статусы физического заказа", () => {
  it("advanceFulfillment проходит accepted → in_production → ready → delivered", async () => {
    const { ctx, order } = setup("accepted");
    const status = () => order().status as string;
    expect(await advance(ctx, status)).toBe("in_production");
    expect(await advance(ctx, status)).toBe("ready");
    expect(await advance(ctx, status)).toBe("delivered");
    expect(order().status).toBe("delivered");
  });

  it("advanceFulfillment из delivered дальше не идёт", async () => {
    expect(PHYSICAL_NEXT.delivered).toBeUndefined();
    expect(PHYSICAL_NEXT.rejected).toBeUndefined();
    const { ctx, order } = setup("delivered");
    expect(await advance(ctx, () => order().status as string)).toBeNull();
    expect(order().status).toBe("delivered");
  });

  it("двойное нажатие: из двух одновременных advanceFulfillment ровно один продвигает статус", async () => {
    const { ctx, order } = setup("accepted");
    const r = await Promise.all([
      setPhysicalStatus(ctx, 1, "accepted", "in_production"),
      setPhysicalStatus(ctx, 1, "accepted", "in_production"),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(order().status).toBe("in_production");
  });
});
