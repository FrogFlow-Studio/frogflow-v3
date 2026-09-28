import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/config/env", () => ({ env: () => ({}) }));
const { MAX_DEVICES, pushAdmins, pushFromHtml, saveAdminPush, removeAdminPush, vapidFromEnv } =
  await import("./admin-push");

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const VAPID = { publicKey: "pk", privateKey: "sk", subject: "mailto:x@y.z" };
const sub = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  p256dh: "p".repeat(80),
  auth: "a".repeat(22),
});

function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("push в админку", () => {
  it("без ключей VAPID push выключен", async () => {
    expect(vapidFromEnv()).toBeNull();
    const { ctx } = shop();
    expect(await pushAdmins(ctx, { title: "t", body: "", url: "/admin" })).toBe(0);
  });

  it("подписка — одна на адрес браузера; чужой адрес не сохраняется; старые сверх предела снимаются", async () => {
    const { ctx, db } = shop();
    expect(await saveAdminPush(ctx, sub(1), "admin:a")).toBe(true);
    expect(await saveAdminPush(ctx, sub(1), "admin:a")).toBe(true);
    expect(db.tables.app_settings).toHaveLength(1);
    expect(
      await saveAdminPush(ctx, { ...sub(2), endpoint: "https://evil.example/x" }, "admin:a"),
    ).toBe(false);
    for (let i = 0; i < MAX_DEVICES + 2; i++)
      await saveAdminPush(ctx, sub(100 + i), "admin:a", new Date(Date.UTC(2026, 0, 1, 0, i + 1)));
    expect(db.tables.app_settings).toHaveLength(MAX_DEVICES);
    await removeAdminPush(ctx, sub(100 + MAX_DEVICES + 1).endpoint);
    expect(db.tables.app_settings).toHaveLength(MAX_DEVICES - 1);
  });

  it("рассылка на все устройства; снятые в браузере подписки удаляются", async () => {
    const { ctx, db } = shop();
    await saveAdminPush(ctx, sub(1), "admin:a");
    await saveAdminPush(ctx, sub(2), "admin:b");
    const send = vi.fn(async (s: { endpoint: string }) =>
      s.endpoint.endsWith("/2") ? ("gone" as const) : ("sent" as const),
    );
    const n = await pushAdmins(
      ctx,
      { title: "Заказ #5", body: "", url: "/admin/orders/5" },
      VAPID,
      send,
    );
    expect(n).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(db.tables.app_settings).toHaveLength(1);
  });

  it("заголовок — первая строка уведомления без разметки", () => {
    expect(pushFromHtml("🛒 <b>Новый заказ #12</b>\nСумма: 5 000 &amp; доставка")).toEqual({
      title: "🛒 Новый заказ #12",
      body: "Сумма: 5 000 & доставка",
    });
  });
});
