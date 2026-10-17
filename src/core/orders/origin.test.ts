import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { resolveOrderOrigin } from "./origin";
import type { OrderRow } from "./order-model";
import type { OrderEvent } from "./events";

const BOT = "11111111-1111-1111-1111-111111111111";

function makeCtx(db: ReturnType<typeof fakeDb>): TenantContext {
  return {
    tenant: {
      id: BOT,
      slug: "test-shop",
      modules: {},
      settings: {
        zernio: {
          accounts: [{ id: "acc-1", platform: "instagram", username: "shop_ig" }],
        },
      },
    },
    db: db as unknown as TenantContext["db"],
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

describe("resolveOrderOrigin", () => {
  it("ручной заказ определяется корректно", async () => {
    const db = fakeDb();
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 1,
      platform: "manual",
      username: null,
      user_key: null,
      zernio_conversation_id: null,
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("manual");
    expect(res.label).toBe("Заведён вручную продавцом");
  });

  it("заказ с витрины (сайт) определяется корректно", async () => {
    const db = fakeDb();
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 2,
      platform: "web",
      username: null,
      user_key: null,
      zernio_conversation_id: null,
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("web");
    expect(res.label).toBe("Витрина (сайт)");
  });

  it("заказ из Telegram определяется корректно", async () => {
    const db = fakeDb();
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 3,
      platform: "telegram",
      username: "buyer_tg",
      user_key: "tg:123",
      zernio_conversation_id: null,
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("telegram");
    expect(res.label).toBe("Telegram-бот");
  });

  it("заказ из Instagram Direct по кодовому слову извлекает ключевое слово и правило", async () => {
    const db = fakeDb();
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: "ig_comment_automations_meta",
        value: JSON.stringify({
          rule_bread: {
            twoStepDm: true,
            secondDmMessage: "Ссылка на хлеб",
          },
        }),
      },
    ];
    db.tables.zernio_logs = [
      {
        bot_id: BOT,
        event_id: "two-step-dm:kw:conv-1:rule_bread:100",
        event_type: "two_step_dm_sent",
        status: "processed",
        created_at: "2026-10-18T09:30:00Z",
        payload: {
          username: "maria_bakes",
          automationId: "rule_bread",
          via: "dm_keyword",
        },
      },
    ];
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 4,
      platform: "instagram",
      username: "maria_bakes",
      user_key: "ig:maria_bakes",
      zernio_conversation_id: "conv-1",
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("instagram_keyword");
    expect(res.label).toContain("Instagram Direct: по кодовому слову");
    expect(res.explanation).toContain("кодовое слово");
  });

  it("заказ из Instagram после комментария рилса распознаёт цепочку «+»", async () => {
    const db = fakeDb();
    db.tables.zernio_logs = [
      {
        bot_id: BOT,
        event_id: "two-step-dm:comment_123",
        event_type: "two_step_dm_sent",
        status: "processed",
        created_at: "2026-10-18T09:40:00Z",
        payload: {
          username: "alex_travel",
          automationId: "reel_rule_1",
          authorId: "ig:alex",
        },
      },
    ];
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 5,
      platform: "instagram",
      username: "alex_travel",
      user_key: "ig:alex",
      zernio_conversation_id: "conv-2",
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("instagram_comment");
    expect(res.label).toContain("Instagram: ответ «+» на комментарий");
  });

  it("заказ из Instagram без автоматизаций помечается как каталог/корзина Direct", async () => {
    const db = fakeDb();
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 6,
      platform: "instagram",
      username: "new_client",
      user_key: "ig:new",
      zernio_conversation_id: "conv-3",
      created_at: "2026-10-18T10:00:00Z",
    };
    const res = await resolveOrderOrigin(ctx, order);
    expect(res.type).toBe("instagram_direct");
    expect(res.label).toBe("Instagram Direct (каталог / корзина)");
  });

  it("если в событии placed уже есть готовый origin, возвращает его", async () => {
    const db = fakeDb();
    const ctx = makeCtx(db);
    const order: Pick<
      OrderRow,
      "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
    > = {
      id: 7,
      platform: "instagram",
      username: "fast_buyer",
      user_key: "ig:fast",
      zernio_conversation_id: "conv-4",
      created_at: "2026-10-18T10:00:00Z",
    };
    const events: OrderEvent[] = [
      {
        id: "ev-1",
        at: "2026-10-18T10:00:00Z",
        kind: "placed",
        actor: "bot",
        payload: {
          platform: "instagram",
          origin: {
            type: "instagram_keyword",
            label: "Instagram Direct: по кодовому слову «Хлеб» (правило «день хлеба»)",
            channel: "instagram",
            ruleName: "день хлеба",
            keyword: "Хлеб",
          },
        },
      },
    ];
    const res = await resolveOrderOrigin(ctx, order, events);
    expect(res.type).toBe("instagram_keyword");
    expect(res.label).toBe("Instagram Direct: по кодовому слову «Хлеб» (правило «день хлеба»)");
    expect(res.keyword).toBe("Хлеб");
  });
});
