import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { activateSubscription, listSubscriptions, type VipGroup } from "./vip";

const BOT = "00000000-0000-0000-0000-000000000001";
const TG = 777;

function setup(opts: { status?: string; groupId?: string } = {}) {
  const db = fakeDb();
  db.tables.app_settings =
    opts.groupId === ""
      ? []
      : [{ bot_id: BOT, key: "vip_group_id", value: opts.groupId ?? "-100500" }];
  db.tables.vip_subscriptions = [
    {
      id: "sub-1-aaaaaaaa",
      bot_id: BOT,
      telegram_id: TG,
      status: opts.status ?? "pending_payment",
      expires_at: null,
      group_invite_link: null,
      vip_tariffs: null,
    },
  ];
  const group = {
    member: vi.fn(async () => null),
    createInvite: vi.fn(async () => "https://t.me/+invite"),
    revokeInvite: vi.fn(async () => {}),
    kick: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async () => true),
  } satisfies VipGroup;
  const ctx = {
    tenant: { id: BOT, modules: {}, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx, group, sub: () => db.tables.vip_subscriptions![0]! };
}

describe("activateSubscription — подтверждение VIP-заявки", () => {
  it("статус не pending_payment (cancelled) — отклоняется с понятной причиной", async () => {
    const { ctx, group, sub } = setup({ status: "cancelled" });
    await expect(activateSubscription(ctx, group, "sub-1-aaaaaaaa")).rejects.toMatchObject({
      key: "err.vip.confirmOnlyPending",
    });
    expect(group.createInvite).not.toHaveBeenCalled();
    expect(group.send).not.toHaveBeenCalled();
    expect(sub().status).toBe("cancelled");
  });

  it("vip_group_id не настроен в панели — отклоняется до создания инвайта", async () => {
    const { ctx, group, sub } = setup({ groupId: "" });
    await expect(activateSubscription(ctx, group, "sub-1-aaaaaaaa")).rejects.toMatchObject({
      key: "err.vip.groupIdMissingInSettings",
    });
    expect(group.member).not.toHaveBeenCalled();
    expect(group.createInvite).not.toHaveBeenCalled();
    expect(sub().status).toBe("pending_payment");
  });

  it("заявку уже обработал другой администратор — откатывает только что созданный инвайт", async () => {
    const { ctx, group, sub } = setup();
    // Пока этот админ создаёт инвайт, другой успевает отклонить заявку.
    group.createInvite.mockImplementation(async () => {
      sub().status = "rejected";
      return "https://t.me/+invite";
    });
    await expect(activateSubscription(ctx, group, "sub-1-aaaaaaaa")).rejects.toMatchObject({
      key: "err.vip.processedByAnotherAdmin",
    });
    expect(group.revokeInvite).toHaveBeenCalledWith("-100500", "https://t.me/+invite");
    expect(group.send).not.toHaveBeenCalled();
    expect(sub().status).toBe("rejected");
  });

  it("новый инвайт создан, но Telegram отклонил его доставку — подписка активна, deliveryFailed: true", async () => {
    const { ctx, group, sub } = setup();
    group.send.mockResolvedValue(false);
    const r = await activateSubscription(ctx, group, "sub-1-aaaaaaaa");
    expect(r).toMatchObject({ ok: true, deliveryFailed: true });
    expect(sub()).toMatchObject({ status: "active", group_invite_link: "https://t.me/+invite" });
    expect(group.revokeInvite).not.toHaveBeenCalled();
  });
});

describe("listSubscriptions — без обрезки на 300", () => {
  it("350 подписок: самая старая заявка с чеком на месте", async () => {
    const { ctx, db } = setup();
    db.tables.vip_subscriptions = Array.from({ length: 350 }, (_, i) => ({
      id: `sub-${String(i).padStart(4, "0")}`,
      bot_id: BOT,
      telegram_id: 1000 + i,
      status: i === 0 ? "pending_payment" : "active",
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      vip_tariffs: null,
    }));
    const all = await listSubscriptions(ctx);
    expect(all).toHaveLength(350);
    expect(all.at(-1)).toMatchObject({ id: "sub-0000", status: "pending_payment" });
    expect(await listSubscriptions(ctx, { status: "pending_payment" })).toHaveLength(1);
  });
});
