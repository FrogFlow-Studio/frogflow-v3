import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseChannelInvite, INVITE_TTL_S, inviteKey } from "./channel.server";
import type { CoursePurchase } from "./run.server";

/** Ссылка в закрытый канал курса: одна на покупку, пока действует. */
const T = "11111111-2222-3333-4444-555555555555";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const p: CoursePurchase = {
  orderItemId: ITEM,
  orderId: 5,
  telegramId: 42,
  boughtAt: "2026-09-01T00:00:00Z",
  variantId: null,
  productId: "p",
  name: "Аквагрим",
  course: { schedule: { mode: "all" }, lessons: [], channel: "@school_club" },
  run: null,
};
const ctxWith = () =>
  ({
    tenant: { id: T },
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
  }) as unknown as TenantContext;

describe("приглашение в канал курса", () => {
  it("Telegram отказал — брони нет, следующая попытка выпускает ссылку", async () => {
    const ctx = ctxWith();
    const now = new Date("2026-10-01T10:00:00Z");
    const refused = await courseChannelInvite(ctx, p, { createInvite: async () => null }, now);
    expect(refused).toEqual({ ok: false, reason: "failed" });
    const names: string[] = [];
    const ok = await courseChannelInvite(
      ctx,
      p,
      {
        createInvite: async (chat, name, exp) => {
          names.push(`${chat} ${name} ${exp}`);
          return "https://t.me/+a";
        },
      },
      now,
    );
    expect(ok).toEqual({ ok: true, link: "https://t.me/+a" });
    expect(names).toEqual([`@school_club #5 Аквагрим ${now.getTime() / 1000 + INVITE_TTL_S}`]);
  });

  it("ссылка на исходе — выпускается новая, свежая — отдаётся та же", async () => {
    const ctx = ctxWith();
    let n = 0;
    const inviter = { createInvite: async () => `https://t.me/+${++n}` };
    const t0 = new Date("2026-10-01T10:00:00Z");
    await courseChannelInvite(ctx, p, inviter, t0);
    const soon = new Date(t0.getTime() + 3600_000);
    expect(await courseChannelInvite(ctx, p, inviter, soon)).toEqual({
      ok: true,
      link: "https://t.me/+1",
    });
    const late = new Date(t0.getTime() + (INVITE_TTL_S - 1800) * 1000);
    expect(await courseChannelInvite(ctx, p, inviter, late)).toEqual({
      ok: true,
      link: "https://t.me/+2",
    });
    expect(
      await ctx.db.from("app_settings").select("key").eq("key", inviteKey(ITEM)),
    ).toMatchObject({ data: [{ key: inviteKey(ITEM) }] });
  });

  it("у курса нет канала — ничего не создаётся", async () => {
    const r = await courseChannelInvite(
      ctxWith(),
      { ...p, course: { ...p.course, channel: null } },
      { createInvite: async () => "x" },
    );
    expect(r).toEqual({ ok: false, reason: "noChannel" });
  });
});

describe("участник канала и возврат", () => {
  const T0 = new Date("2026-10-01T10:00:00Z");
  function access(inside: Set<number>) {
    const calls: string[] = [];
    let n = 0;
    return {
      calls,
      port: {
        createInvite: async () => `https://t.me/+link${++n}`,
        isMember: async (_c: string, u: number) => inside.has(u),
        kick: async (_c: string, u: number) => (calls.push(`kick:${u}`), inside.delete(u), true),
        revokeInvite: async (_c: string, l: string) => void calls.push(`revoke:${l}`),
      },
    };
  }

  it("вступил по ссылке — второй ссылки нет, пока он в канале; вышел — новая", async () => {
    const { recordChannelJoin } = await import("./channel.server");
    const ctx = ctxWith();
    const inside = new Set<number>();
    const { port } = access(inside);
    const first = await courseChannelInvite(ctx, p, port, T0);
    expect(first).toEqual({ ok: true, link: "https://t.me/+link1" });
    expect(await recordChannelJoin(ctx, "https://t.me/+link1", 4242)).toBe(true);
    inside.add(4242);
    expect(await courseChannelInvite(ctx, p, port, T0)).toEqual({
      ok: false,
      reason: "alreadyMember",
    });
    inside.delete(4242);
    expect(await courseChannelInvite(ctx, p, port, T0)).toEqual({
      ok: true,
      link: "https://t.me/+link2",
    });
    // Чужая ссылка (не курса) — не находится.
    expect(await recordChannelJoin(ctx, "https://t.me/+other", 1)).toBe(false);
  });

  it("возврат: вступивший исключён, ссылка отозвана, новых ссылок нет; повтор ничего не делает", async () => {
    const { recordChannelJoin, revokeCourseChannels } = await import("./channel.server");
    const ctx = ctxWith();
    const db = ctx.db as unknown as ReturnType<typeof fakeDb>;
    db.tables.orders = [{ id: 5, platform: "web", telegram_id: -1 }];
    db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: "p" }];
    (db.tables.app_settings ??= []).push({
      bot_id: T,
      key: "course_p",
      value: JSON.stringify({
        schedule: { mode: "all" },
        lessons: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            title: "1",
            text: "т",
            files: [],
            link: null,
          },
        ],
        channel: "@school_club",
      }),
    });
    (ctx.tenant as unknown as { modules: Record<string, boolean> }).modules = { courses: true };
    const inside = new Set<number>([4242]);
    const { port, calls } = access(inside);
    await courseChannelInvite(ctx, p, port, T0);
    await recordChannelJoin(ctx, "https://t.me/+link1", 4242);
    expect(await revokeCourseChannels(ctx, 5, port, T0)).toBe(1);
    expect(calls).toEqual(["revoke:https://t.me/+link1", "kick:4242"]);
    expect(await courseChannelInvite(ctx, p, port, T0)).toEqual({ ok: false, reason: "noChannel" });
    expect(await revokeCourseChannels(ctx, 5, port, T0)).toBe(0);
  });

  async function courseOrder() {
    const ctx = ctxWith();
    const db = ctx.db as unknown as ReturnType<typeof fakeDb>;
    db.tables.orders = [{ id: 5, platform: "web", telegram_id: -1 }];
    db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: "p" }];
    (db.tables.app_settings ??= []).push({
      bot_id: T,
      key: "course_p",
      value: JSON.stringify({ schedule: { mode: "all" }, lessons: [], channel: "@school_club" }),
    });
    (ctx.tenant as unknown as { modules: Record<string, boolean> }).modules = { courses: true };
    return { ctx, db };
  }
  const kinds = (db: ReturnType<typeof fakeDb>) =>
    (db.tables.zernio_logs ?? []).map((r) => String(r.event_type));

  it("возврат: итог исключения пишется в историю заказа", async () => {
    const { recordChannelJoin, revokeChannelsOnRefund } = await import("./channel.server");
    const { ctx, db } = await courseOrder();
    const { port } = access(new Set([4242]));
    await courseChannelInvite(ctx, p, port, T0);
    await recordChannelJoin(ctx, "https://t.me/+link1", 4242);
    expect(await revokeChannelsOnRefund(ctx, 5, port, "admin", T0)).toEqual({
      kicked: 1,
      failed: 0,
    });
    expect(kinds(db)).toEqual(["order.channel_revoked"]);
    // Повтор ничего не меняет и не дублирует запись.
    await revokeChannelsOnRefund(ctx, 5, port, "admin", T0);
    expect(kinds(db)).toEqual(["order.channel_revoked"]);
  });

  it("Telegram не исключил — продавец видит это в истории заказа", async () => {
    const { recordChannelJoin, revokeChannelsOnRefund } = await import("./channel.server");
    const { ctx, db } = await courseOrder();
    const { port } = access(new Set([4242]));
    await courseChannelInvite(ctx, p, port, T0);
    await recordChannelJoin(ctx, "https://t.me/+link1", 4242);
    const refusing = { ...port, kick: async () => false };
    expect(await revokeChannelsOnRefund(ctx, 5, refusing, "admin", T0)).toEqual({
      kicked: 0,
      failed: 1,
    });
    expect(kinds(db)).toEqual(["order.channel_revoke_failed"]);
  });
});
