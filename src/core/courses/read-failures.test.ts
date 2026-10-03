import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { courseKey, type Course } from "./course";
import {
  channelStrangers,
  kickChannelStranger,
  recordChannelSighting,
} from "./channel-seen.server";
import { revokeChannelsOnRefund, revokeItemChannelDetailed } from "./channel.server";
import { coursePurchase } from "./run.server";
import { readSetting } from "./db.server";

/** Сбой чтения базы в школе — это «не удалось», а не «нет данных»: никого не исключаем вслепую. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [],
  channel: "-1001234567890",
};
const NOW = new Date("2026-10-10T10:00:00Z");

function school() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: null, name_snapshot: "К" },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const make = (d: typeof db) =>
    ({
      tenant: { id: T, modules: { courses: true } },
      db: d,
      timezone: "Europe/Moscow",
    }) as unknown as TenantContext;
  return { db, ctx: make(db), broken: (tables: string[]) => make(withBrokenReads(db, tables)) };
}
const kicks: number[] = [];
const access = {
  createInvite: async () => null,
  kick: async (_c: string, u: number) => (kicks.push(u), true),
};

describe("сбой чтения в школе", () => {
  it("сверка и исключение постороннего: упавшее чтение — ошибка, исключения нет", async () => {
    const s = school();
    await recordChannelSighting(s.ctx, { id: -1001234567890 }, 999, "member", {}, NOW);
    for (const tables of [["orders"], ["order_items"]]) {
      kicks.length = 0;
      const ctx = s.broken(tables);
      await expect(channelStrangers(ctx, NOW)).rejects.toThrow();
      await expect(kickChannelStranger(ctx, course.channel!, 999, access, NOW)).rejects.toThrow();
      expect(kicks).toEqual([]);
    }
    // а исправная база исключает: тест проверяет настоящий путь, не только отказ
    expect(await kickChannelStranger(s.ctx, course.channel!, 999, access, NOW)).toEqual({
      kicked: true,
    });
    expect(kicks).toEqual([999]);
  });

  it("возврат: заказ не прочитан — не «исключать некого», а «не удалось» в истории заказа", async () => {
    const s = school();
    kicks.length = 0;
    const r = await revokeChannelsOnRefund(s.broken(["orders"]), 7, access, "admin", NOW);
    expect(r).toEqual({ kicked: 0, failed: 1 });
    expect(kicks).toEqual([]);
    const ev = (s.db.tables.zernio_logs as Array<{ event_type: string }>).map((e) => e.event_type);
    expect(ev).toEqual(["order.channel_revoke_failed"]);
  });

  it("снятие доступа: отметку «снято» не поставили — это сбой, не «уже снято»", async () => {
    const s = school();
    const order = { platform: "telegram", telegram_id: 555 };
    kicks.length = 0;
    expect(
      await revokeItemChannelDetailed(
        s.broken(["app_settings"]),
        "item-1",
        course.channel!,
        order,
        access,
        NOW,
      ),
    ).toBe("failed");
    expect(kicks).toEqual([]);
    expect(
      await revokeItemChannelDetailed(s.ctx, "item-1", course.channel!, order, access, NOW),
    ).toBe("kicked");
    expect(
      await revokeItemChannelDetailed(s.ctx, "item-1", course.channel!, order, access, NOW),
    ).toBe("none");
  });

  it("покупка курса и настройка: сбой чтения — ошибка, а не «нет покупки / нет настройки»", async () => {
    const s = school();
    await expect(coursePurchase(s.broken(["order_items"]), "item-1")).rejects.toThrow();
    await expect(coursePurchase(s.broken(["orders"]), "item-1")).rejects.toThrow();
    await expect(readSetting(s.broken(["app_settings"]), courseKey(P))).rejects.toThrow();
    expect(await readSetting(s.ctx, "нет-такой")).toBeNull();
  });
});
