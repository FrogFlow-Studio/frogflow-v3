import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ServerFailure } from "@/lib/server-failure";
import { totalUnread } from "./chat";

const BOT = "11111111-1111-1111-1111-111111111111";

/** Магазин на 30 000 диалогов, непрочитанное только в 50 из них. */
function shop() {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.manager_chat_state = Array.from({ length: 30000 }, (_, i) => ({
    bot_id: BOT,
    telegram_id: i + 1,
    unread_count: i % 600 === 0 ? 2 : 0,
  }));
  let reads = 0;
  const counting = new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => {
            reads++;
            return t.from(name);
          }
        : Reflect.get(t, prop, r),
  });
  return {
    ctx: { tenant: { id: BOT }, db: counting } as unknown as TenantContext,
    reads: () => reads,
  };
}

describe("Д5: бейдж «Чат» в шапке", () => {
  it("30 000 диалогов: считает по непрочитанным, одним запросом, сумма верная", async () => {
    const { ctx, reads } = shop();
    expect(await totalUnread(ctx)).toBe(100);
    expect(reads()).toBe(1);
  });

  it("сбой чтения — ServerFailure, а не «0»", async () => {
    const broken = {
      tenant: { id: BOT },
      db: {
        from: () => {
          const q: unknown = new Proxy(() => undefined, {
            get: (_t, p) =>
              p === "then"
                ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
                : () => q,
          });
          return q;
        },
      },
    } as unknown as TenantContext;
    await expect(totalUnread(broken)).rejects.toBeInstanceOf(ServerFailure);
  });
});
