import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { runVipCron } from "./cron";
import type { VipGroup } from "./vip";

/** Два крона одновременно (окно переключения v2 → v3): одно письмо и одна отметка. */
const NOW = new Date("2026-10-10T08:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function setup(sub: Record<string, unknown>) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: "bot", key: "vip_group_id", value: "-1001" }];
  db.tables.vip_subscriptions = [
    {
      id: "s1",
      telegram_id: 7,
      status: "active",
      admin_note: null,
      group_invite_link: null,
      ...sub,
    },
  ];
  const ctx = {
    tenant: { id: "bot", modules: {}, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  const group = {
    member: vi.fn(async () => ({ status: "member" })),
    createInvite: vi.fn(async () => null),
    revokeInvite: vi.fn(async () => {}),
    kick: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async () => true),
  } satisfies VipGroup;
  return { db, ctx, group };
}

const twice = (ctx: TenantContext, group: VipGroup) =>
  Promise.all([runVipCron(ctx, group, "bot", NOW), runVipCron(ctx, group, "bot", NOW)]);

describe("VIP-крон: два прогона одновременно", () => {
  it("первое предупреждение — одно сообщение, отметка warned", async () => {
    const { db, ctx, group } = setup({ expires_at: inDays(2.5) });
    const [a, b] = await twice(ctx, group);
    expect(group.send).toHaveBeenCalledTimes(1);
    expect(a.warned + b.warned).toBe(1);
    expect(db.tables.vip_subscriptions![0]!.admin_note).toBe("warned");
  });

  it("второе предупреждение — одно сообщение, отметка warned2", async () => {
    const { db, ctx, group } = setup({ expires_at: inDays(0.5), admin_note: "warned" });
    const [a, b] = await twice(ctx, group);
    expect(group.send).toHaveBeenCalledTimes(1);
    expect(a.warned2 + b.warned2).toBe(1);
    expect(db.tables.vip_subscriptions![0]!.admin_note).toBe("warned2");
  });

  it("истечение — одно «подписка истекла» и один expired", async () => {
    const { db, ctx, group } = setup({ expires_at: inDays(-0.1), admin_note: "warned2" });
    const [a, b] = await twice(ctx, group);
    expect(group.send).toHaveBeenCalledTimes(1);
    expect(a.expired + b.expired).toBe(1);
    expect(db.tables.vip_subscriptions![0]!.status).toBe("expired");
  });

  it("сорвавшаяся отправка предупреждения не теряет его: следующий прогон повторит", async () => {
    const { db, ctx, group } = setup({ expires_at: inDays(2.5) });
    group.send.mockResolvedValueOnce(false);
    const first = await runVipCron(ctx, group, "bot", NOW);
    expect(first.warned).toBe(0);
    expect(db.tables.vip_subscriptions![0]!.admin_note).toBeNull();
    const second = await runVipCron(ctx, group, "bot", NOW);
    expect(second.warned).toBe(1);
  });
});
