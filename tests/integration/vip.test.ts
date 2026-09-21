import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { setSetting } from "@/core/settings/settings";
import {
  activateSubscription,
  activeSubscription,
  deleteTariff,
  extendSubscription,
  getSubscription,
  hadPaidAccess,
  listSubscriptions,
  memberAssignedTariff,
  pendingSubscription,
  rejectSubscription,
  saveTariff,
  startPending,
  type VipGroup,
} from "@/core/vip/vip";
import { runVipCron } from "@/core/vip/cron";

/**
 * VIP-подписки против настоящей базы с подменённой группой Telegram: заявка,
 * подтверждение с инвайтом и стыковкой срока, продление, отказ, крон
 * напоминаний и исключения. Строки — под своим telegram_id, убираются.
 */
const TG = TEST_TG_ID + 70;
const GROUP = "-1000000000777";
let ctx: TenantContext;
const tariffIds: string[] = [];
const log: string[] = [];
let inGroup = false;
const group: VipGroup = {
  member: async (_g, id) =>
    inGroup ? { status: "member", user: { id, first_name: "Проба" } } : { status: "left" },
  createInvite: async (_g, name) => {
    log.push(`invite:${name.split("-")[1]}`);
    return `https://t.me/+${name}`;
  },
  revokeInvite: async (_g, link) => {
    log.push(`revoke:${link}`);
  },
  kick: async (_g, id) => {
    log.push(`kick:${id}`);
    inGroup = false;
    return { ok: true };
  },
  send: async (_id, html) => {
    log.push(`send:${html.split("\n")[0]}`);
    return true;
  },
};

async function cleanup() {
  const db = serviceDb();
  await db.from("vip_subscriptions").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("vip_member_profiles").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("vip_tariffs").delete().eq("bot_id", DEMO_BOT).like("name", "v2 vip ·%");
}

describe.skipIf(!liveReady)("VIP-подписки на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...tenant, modules: { ...tenant.modules, vip: true } });
    await cleanup();
    await setSetting(ctx, "vip_group_id", GROUP);
    await setSetting(ctx, "vip_test_mode", "false");
    await setSetting(ctx, "vip_welcome_message", "Добро пожаловать в клуб");
    tariffIds.push(
      await saveTariff(ctx, {
        name: "v2 vip · месяц",
        price: 5000,
        currency: "KZT",
        duration_days: 30,
        is_active: true,
        is_public: true,
        is_entry: false,
        sort_order: 1,
      }),
    );
    tariffIds.push(
      await saveTariff(ctx, {
        name: "v2 vip · скрытый",
        price: 1000,
        currency: "KZT",
        duration_days: 10,
        is_active: true,
        is_public: false,
        is_entry: false,
        sort_order: 2,
      }),
    );
  });
  afterAll(async () => {
    await setSetting(ctx, "vip_group_id", "");
    await cleanup();
  });

  it("заявка одна на человека: смена тарифа переводит существующую, а не плодит новые", async () => {
    const a = await startPending(ctx, TG, { first_name: "Проба" }, tariffIds[0]!);
    const b = await startPending(ctx, TG, { first_name: "Проба" }, tariffIds[1]!);
    expect(b.id).toBe(a.id);
    const p = await pendingSubscription(ctx, TG);
    expect(p?.tariff_id).toBe(tariffIds[1]);
    expect(await hadPaidAccess(ctx, TG)).toBe(false);
  });

  it("подтверждение: инвайт до активации, срок по тарифу, скрытый тариф закрепляется за участником", async () => {
    const p = (await pendingSubscription(ctx, TG))!;
    log.length = 0;
    const r = await activateSubscription(ctx, group, p.id);
    expect(r.deliveryFailed).toBe(false);
    const active = await activeSubscription(ctx, TG);
    expect(active?.id).toBe(p.id);
    expect(active?.group_invite_link).toContain("https://t.me/+vip-");
    const days = (new Date(active!.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(9.9);
    expect(days).toBeLessThan(10.1);
    expect(log[0]).toMatch(/^invite:/);
    expect(log.some((l) => l.startsWith("send:✅ Добро пожаловать"))).toBe(true);
    expect((await memberAssignedTariff(ctx, TG))?.id).toBe(tariffIds[1]);
    await expect(activateSubscription(ctx, group, p.id)).rejects.toThrow(/уже активна/);
  });

  it("продление стыкуется к остатку срока, старая активная закрывается, участник в группе — без новой ссылки", async () => {
    inGroup = true;
    const first = (await activeSubscription(ctx, TG))!;
    const again = await startPending(ctx, TG, { first_name: "Проба" }, tariffIds[0]!);
    expect(again.id).not.toBe(first.id);
    log.length = 0;
    await activateSubscription(ctx, group, again.id);
    const active = (await activeSubscription(ctx, TG))!;
    expect(active.id).toBe(again.id);
    const expectedMs = new Date(first.expires_at).getTime() + 30 * 86_400_000;
    expect(Math.abs(new Date(active.expires_at).getTime() - expectedMs)).toBeLessThan(5_000);
    expect(active.group_invite_link).toBeNull();
    expect((await getSubscription(ctx, first.id))?.status).toBe("expired");
    expect(log.some((l) => l.startsWith("invite:"))).toBe(false);
  });

  it("±дни: продление активной от её срока, уменьшение в прошлое завершает и исключает", async () => {
    const active = (await activeSubscription(ctx, TG))!;
    const r = await extendSubscription(ctx, group, active.id, 5);
    expect(r.expired).toBe(false);
    expect(new Date(r.expiresAt).getTime() - new Date(active.expires_at).getTime()).toBe(
      5 * 86_400_000,
    );
    log.length = 0;
    const cut = await extendSubscription(ctx, group, active.id, -400);
    expect(cut.expired).toBe(true);
    expect((await getSubscription(ctx, active.id))?.status).toBe("expired");
    expect(log).toContain(`kick:${TG}`);
    expect(await activeSubscription(ctx, TG)).toBeNull();
  });

  it("крон: активная с прошедшей датой исключается и помечается expired; отклонение заявки", async () => {
    const pend = await startPending(ctx, TG, { first_name: "Проба" }, tariffIds[0]!);
    await activateSubscription(ctx, group, pend.id);
    inGroup = true;
    await ctx.db
      .from("vip_subscriptions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", pend.id);
    log.length = 0;
    const r = await runVipCron(ctx, group, "demo_vip_bot");
    expect(r.expired).toBe(1);
    expect(r.errors).toEqual([]);
    expect(log).toContain(`kick:${TG}`);
    expect((await getSubscription(ctx, pend.id))?.status).toBe("expired");

    const p2 = await startPending(ctx, TG, { first_name: "Проба" }, tariffIds[0]!);
    const rej = await rejectSubscription(ctx, group, p2.id, "нет чека");
    expect(rej.alreadyProcessed).toBeFalsy();
    expect((await getSubscription(ctx, p2.id))?.status).toBe("cancelled");
    expect((await rejectSubscription(ctx, group, p2.id)).alreadyProcessed).toBe(true);
    const all = await listSubscriptions(ctx, { q: String(TG) });
    expect(all.length).toBeGreaterThanOrEqual(3);
    await expect(deleteTariff(ctx, tariffIds[0]!)).rejects.toThrow(/подписки/);
  });
});
