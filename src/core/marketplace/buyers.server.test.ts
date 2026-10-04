import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import {
  buyerShops,
  buyersReady,
  ensureBuyer,
  identityUserKey,
  linkBuyerToShop,
  validIdentity,
  type VerifiedIdentity,
} from "./buyers.server";

/** Аккаунт покупателя площадки: подтверждённое удостоверение, связи с магазинами, чужое не цепляется. */
let svc: FakeDb;
let shopA: FakeDb;
let shopB: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const ctxFor = (id: string, d: FakeDb, served = "v2") =>
  ({
    tenant: { id, settings: { served_by: served } } as unknown as Tenant,
    db: as(d),
  }) as TenantContext;
const ANNA: VerifiedIdentity = { channel: "telegram", id: "1001", via: "telegram_login" };
const BORIS: VerifiedIdentity = { channel: "telegram", id: "2002", via: "code" };

beforeEach(() => {
  svc = fakeDb({
    unique: {
      marketplace_buyers: [["channel", "channel_id"]],
      marketplace_buyer_links: [["bot_id", "user_key"]],
    },
  });
  shopA = fakeDb();
  shopB = fakeDb();
  shopA.tables.bot_users = [
    { bot_id: "A", user_key: "tg_1001", loyalty_points: 120 },
    { bot_id: "A", user_key: "tg_2002", loyalty_points: 5 },
  ];
  shopB.tables.bot_users = [{ bot_id: "B", user_key: "tg_1001", loyalty_points: 40 }];
});

describe("удостоверение", () => {
  it("ключ профиля берётся из канала, плохие id отвергаются", () => {
    expect(identityUserKey(ANNA)).toBe("tg_1001");
    expect(identityUserKey({ channel: "whatsapp", id: "77001234567" })).toBe("wa_77001234567");
    expect(validIdentity({ ...ANNA, id: "0" })).toBe(false);
    expect(validIdentity({ ...ANNA, id: "1 2" })).toBe(false);
    expect(validIdentity({ ...ANNA, id: "" })).toBe(false);
  });
});

describe("человек на площадке", () => {
  it("создаётся один раз, повтор и два входа разом дают один id", async () => {
    const [a, b] = await Promise.all([ensureBuyer(ANNA, as(svc)), ensureBuyer(ANNA, as(svc))]);
    expect(a).toBe(b);
    expect(await ensureBuyer(ANNA, as(svc))).toBe(a);
    expect(svc.tables.marketplace_buyers).toHaveLength(1);
    expect(await ensureBuyer(BORIS, as(svc))).not.toBe(a);
    expect(svc.tables.marketplace_buyers).toHaveLength(2);
  });
});

describe("привязка профиля магазина", () => {
  it("свой профиль привязывается в двух магазинах, баллы магазинов не тронуты", async () => {
    const a = await linkBuyerToShop(ctxFor("A", shopA), ANNA, "tg_1001", as(svc));
    const b = await linkBuyerToShop(ctxFor("B", shopB), ANNA, "tg_1001", as(svc));
    expect(a.status).toBe("linked");
    expect(b.status).toBe("linked");
    const buyerId = (a as { buyerId: string }).buyerId;
    expect(await buyerShops(buyerId, as(svc))).toEqual([
      { botId: "A", userKey: "tg_1001" },
      { botId: "B", userKey: "tg_1001" },
    ]);
    expect(svc.tables.marketplace_buyer_links![0]).toMatchObject({ verified_by: "telegram_login" });
    // баллы остаются в магазине: ни одной записи в bot_users
    expect(shopA.tables.bot_users!.map((u) => u.loyalty_points)).toEqual([120, 5]);
    expect(shopB.tables.bot_users![0]!.loyalty_points).toBe(40);
  });

  it("чужой user_key не прицепить: ключ обязан вытекать из подтверждённого удостоверения", async () => {
    const r = await linkBuyerToShop(ctxFor("A", shopA), ANNA, "tg_2002", as(svc));
    expect(r).toEqual({ status: "foreign" });
    expect(svc.tables.marketplace_buyer_links ?? []).toHaveLength(0);
    expect(svc.tables.marketplace_buyers ?? []).toHaveLength(0);
  });

  it("профиль уже у другого человека — не переписывается; повтор своего — already", async () => {
    // Борис ссылается на «свой» ключ, но запись уже занята Анной (например, номер сменил владельца).
    shopA.tables.bot_users!.push({ bot_id: "A", user_key: "tg_3003" });
    const anna: VerifiedIdentity = { channel: "telegram", id: "3003", via: "code" };
    const first = await linkBuyerToShop(ctxFor("A", shopA), anna, "tg_3003", as(svc));
    expect(first.status).toBe("linked");
    const again = await linkBuyerToShop(ctxFor("A", shopA), anna, "tg_3003", as(svc));
    expect(again.status).toBe("already");
    // другая запись удостоверения на тот же ключ (канал whatsapp не даёт tg_-ключ), поэтому «занято»
    // проверяем напрямую: ссылка на этот профиль уже у buyer первого входа
    svc.tables.marketplace_buyer_links![0]!.buyer_id = "other-buyer";
    const taken = await linkBuyerToShop(ctxFor("A", shopA), anna, "tg_3003", as(svc));
    expect(taken).toEqual({ status: "taken" });
    expect(svc.tables.marketplace_buyer_links![0]!.buyer_id).toBe("other-buyer");
  });

  it("два одновременных входа дают одну связь", async () => {
    const [x, y] = await Promise.all([
      linkBuyerToShop(ctxFor("A", shopA), ANNA, "tg_1001", as(svc)),
      linkBuyerToShop(ctxFor("A", shopA), ANNA, "tg_1001", as(svc)),
    ]);
    expect([x.status, y.status].sort()).toEqual(["already", "linked"]);
    expect(svc.tables.marketplace_buyer_links).toHaveLength(1);
  });

  it("профиля в магазине нет, магазин прежней платформы — не привязываем", async () => {
    expect(await linkBuyerToShop(ctxFor("B", shopB), BORIS, "tg_2002", as(svc))).toEqual({
      status: "no-profile",
    });
    expect(await linkBuyerToShop(ctxFor("A", shopA, "v1"), ANNA, "tg_1001", as(svc))).toEqual({
      status: "unavailable",
    });
    expect(svc.tables.marketplace_buyers ?? []).toHaveLength(0);
  });

  it("сбой чтения профиля — ошибка, а не «нет профиля»", async () => {
    const broken = withBrokenReads(shopA, ["bot_users"]);
    await expect(linkBuyerToShop(ctxFor("A", broken), ANNA, "tg_1001", as(svc))).rejects.toThrow(
      /профиль в магазине не прочитан/,
    );
  });
});

describe("таблиц нет", () => {
  it("buyersReady false, привязка и список — «скоро» (MarketplaceNotReady)", async () => {
    const noTables = {
      from: () => ({
        select: () => ({
          limit: async () => ({ data: null, error: { code: "PGRST205", message: "x" } }),
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { code: "PGRST205", message: "x" } }),
            }),
          }),
        }),
      }),
    } as unknown as Db;
    expect(await buyersReady(noTables)).toBe(false);
    await expect(linkBuyerToShop(ctxFor("A", shopA), ANNA, "tg_1001", noTables)).rejects.toThrow(
      "marketplace-not-ready",
    );
  });
});
