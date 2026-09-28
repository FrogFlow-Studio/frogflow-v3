import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { guardVipJoin, judgeVipJoin, vipLinkPrefix, type ChatMemberUpdate } from "./join-guard";
import type { VipGroup } from "./vip";

/** Вход в VIP-группу по пересланной одноразовой ссылке подписки. */
const GROUP = "-1001234";
const SUB = "abcdef12-0000-0000-0000-000000000000";
const LINK = "https://t.me/+owner";

function setup() {
  const db = fakeDb();
  db.tables.app_settings = [{ bot_id: "b", key: "vip_group_id", value: GROUP }];
  db.tables.vip_subscriptions = [
    {
      id: SUB,
      bot_id: "b",
      telegram_id: 100,
      status: "active",
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      group_invite_link: LINK,
    },
  ];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  const calls: string[] = [];
  const group = {
    kick: vi.fn(async (_g: string, id: number) => {
      calls.push(`kick ${id}`);
      return { ok: true };
    }),
    revokeInvite: vi.fn(async (_g: string, link: string) => {
      calls.push(`revoke ${link}`);
    }),
  } as unknown as VipGroup;
  return { db, ctx, group, calls };
}

const join = (userId: number, over: Partial<ChatMemberUpdate> = {}): ChatMemberUpdate => ({
  chat: { id: Number(GROUP) },
  old_chat_member: { status: "left" },
  new_chat_member: { status: "member", user: { id: userId, first_name: "<Гость>" } },
  invite_link: { invite_link: LINK, name: "vip-abcdef12" },
  ...over,
});

describe("имя нашей ссылки", () => {
  it("vip-, vip-man-, vip-ext-, vip-resend- с 8 символами id; остальное — не наше", () => {
    expect(vipLinkPrefix("vip-abcdef12")).toBe("abcdef12");
    expect(vipLinkPrefix("vip-resend-abcdef12")).toBe("abcdef12");
    expect(vipLinkPrefix("vip-other-abcdef12")).toBeNull();
    expect(vipLinkPrefix("vip-man-ABCDEF12")).toBe("abcdef12");
    expect(vipLinkPrefix("vip-ext-abcdef12")).toBe("abcdef12");
    expect(vipLinkPrefix("Реклама")).toBeNull();
    expect(vipLinkPrefix(undefined)).toBeNull();
  });
});

describe("вход в VIP-группу", () => {
  it("по чужой ссылке без своей подписки — выгнать, ссылку отозвать, продавцу сообщить", async () => {
    const { ctx, group, calls } = setup();
    const notify = vi.fn(async (_html: string) => {});
    const v = await guardVipJoin(ctx, group, join(200), notify);
    expect(v).toMatchObject({ action: "kick", userId: 200, ownerId: 100 });
    expect(calls).toEqual(["kick 200", `revoke ${LINK}`]);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]![0]).toContain("&lt;Гость&gt;");
  });

  it("по переотправленной ссылке (vip-resend-) чужого тоже выгоняем, владельца пускаем", async () => {
    const { ctx, group, calls } = setup();
    const resend = { invite_link: LINK, name: "vip-resend-abcdef12" };
    const v = await guardVipJoin(ctx, group, join(200, { invite_link: resend }), async () => {});
    expect(v).toMatchObject({ action: "kick", userId: 200 });
    expect(calls).toEqual(["kick 200", `revoke ${LINK}`]);
    expect((await judgeVipJoin(ctx, join(100, { invite_link: resend }))).action).toBe("allow");
  });

  it("исключить не удалось — продавцу не пишем «исключён», ссылку всё равно отзываем", async () => {
    const { ctx, group, calls } = setup();
    vi.mocked(group.kick).mockResolvedValueOnce({
      ok: false,
      description: "not enough rights to restrict/ban chat member",
    });
    const notify = vi.fn(async (_html: string) => {});
    await guardVipJoin(ctx, group, join(200), notify);
    expect(calls).toEqual([`revoke ${LINK}`]);
    const html = notify.mock.calls[0]![0];
    expect(html).not.toContain("исключён,");
    expect(html).toContain("исключить не удалось (not enough rights");
  });

  it("владелец ссылки и покупатель со своей активной подпиской — пускаем", async () => {
    const { db, ctx } = setup();
    expect((await judgeVipJoin(ctx, join(100))).action).toBe("allow");
    db.tables.vip_subscriptions!.push({
      id: "99999999-0000-0000-0000-000000000000",
      bot_id: "b",
      telegram_id: 300,
      status: "active",
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    expect((await judgeVipJoin(ctx, join(300))).action).toBe("allow");
  });

  it("истёкшая своя подписка не спасает", async () => {
    const { db, ctx } = setup();
    db.tables.vip_subscriptions!.push({
      id: "99999999-0000-0000-0000-000000000000",
      bot_id: "b",
      telegram_id: 300,
      status: "active",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await judgeVipJoin(ctx, join(300))).action).toBe("kick");
  });

  it("вход не по нашей ссылке, чужая группа, выход, админ — не трогаем", async () => {
    const { ctx } = setup();
    const cases: ChatMemberUpdate[] = [
      join(200, { invite_link: { invite_link: "https://t.me/+public", name: "Реклама" } }),
      join(200, { invite_link: undefined }),
      join(200, { chat: { id: -100999 } }),
      join(200, {
        old_chat_member: { status: "member" },
        new_chat_member: { status: "left", user: { id: 200 } },
      }),
      join(200, { new_chat_member: { status: "administrator", user: { id: 200 } } }),
    ];
    for (const c of cases) expect((await judgeVipJoin(ctx, c)).action).toBe("ignore");
  });

  it("подписки не прочитались — не выгоняем", async () => {
    const { ctx } = setup();
    const from = (ctx.db as { from: (t: string) => unknown }).from.bind(ctx.db);
    const broken = {
      ...ctx,
      db: {
        from: (t: string) =>
          t === "vip_subscriptions"
            ? {
                select: () => ({ eq: async () => ({ data: null, error: { message: "timeout" } }) }),
              }
            : from(t),
      },
    } as unknown as TenantContext;
    expect((await judgeVipJoin(broken, join(200))).action).toBe("allow");
  });
});
