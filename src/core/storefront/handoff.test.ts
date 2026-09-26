import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

const service = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => service }));
const added: Array<[string, string | null]> = [];
vi.mock("@/core/cart/cart", () => ({
  addToCart: vi.fn(async (_ctx: unknown, _c: unknown, pid: string, vid: string | null) => {
    added.push([pid, vid]);
    return "ok";
  }),
}));

const { claimHandoff, createHandoff, HANDOFF_PREFIX, parseHandoffItems } =
  await import("./handoff");

const BOT = "11111111-1111-1111-1111-111111111111";
const P1 = "22222222-2222-2222-2222-222222222222";
const ctx = {
  tenant: { id: BOT, settings: { telegram: { username: "shop_bot" } } },
} as unknown as TenantContext;
const customer = { telegramId: 42 } as Customer;

describe("перенос корзины в бота: deep link", () => {
  it("ссылка — t.me/<бот>?start=wc_<токен>, и бот принимает токен после префикса", async () => {
    expect(HANDOFF_PREFIX).toBe("wc_");
    const r = await createHandoff(ctx, [{ product_id: P1, quantity: 2 }]);
    expect(r?.url).toMatch(/^https:\/\/t\.me\/shop_bot\?start=wc_[0-9a-f]{32}$/);
    // Так бот режет /start-параметр (channels/telegram/handle-update.ts, startFlow).
    const payload = new URL(r!.url).searchParams.get("start")!;
    expect(payload.startsWith(HANDOFF_PREFIX)).toBe(true);
    const token = payload.slice(HANDOFF_PREFIX.length);
    expect(token).toBe(r!.token);
    expect(await claimHandoff(ctx, customer, token)).toBe("ok");
    expect(added).toEqual([
      [P1, null],
      [P1, null],
    ]);
    expect(await claimHandoff(ctx, customer, token)).toBe("claimed");
  });

  it("без имени бота или без позиций ссылки нет", async () => {
    const noBot = { tenant: { id: BOT, settings: {} } } as unknown as TenantContext;
    expect(await createHandoff(noBot, [{ product_id: P1, quantity: 1 }])).toBeNull();
    expect(await createHandoff(ctx, [])).toBeNull();
  });
});

describe("parseHandoffItems", () => {
  it("количество по умолчанию 1, в пределах 1..99, вариант необязателен", () => {
    expect(parseHandoffItems([{ product_id: P1 }])).toEqual([
      { product_id: P1, product_variant_id: null, quantity: 1 },
    ]);
    expect(parseHandoffItems([{ product_id: P1, quantity: "abc" }])[0]!.quantity).toBe(1);
    expect(parseHandoffItems([{ product_id: P1, quantity: 0 }])[0]!.quantity).toBe(1);
    expect(parseHandoffItems([{ product_id: P1, quantity: 2.7 }])[0]!.quantity).toBe(2);
    expect(parseHandoffItems([{ product_id: P1, quantity: 500 }])[0]!.quantity).toBe(99);
    expect(parseHandoffItems([{ product_id: "not-a-uuid" }, null, "x"])).toEqual([]);
    expect(parseHandoffItems("nope")).toEqual([]);
  });
});
