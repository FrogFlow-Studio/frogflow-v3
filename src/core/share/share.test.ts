import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { sourceGroup } from "@/core/analytics/source-funnel";
import { webSource, isWebSource } from "@/core/storefront/web-source";
import { rememberFirstSource } from "@/core/storefront/web-order";
import { SHARE_CHANNELS, mainLink, plainLinks, qrSvg, shareLinks } from "./share";

const targets = { bot: "shop_bot", store: "https://shop.frogflow.tech/s/cakes" };

describe("ссылки по каналам", () => {
  it("у каждого канала готовая метка и обе ссылки", () => {
    for (const ch of SHARE_CHANNELS) {
      const l = shareLinks(targets, ch)!;
      expect(l.bot).toBe(`https://t.me/shop_bot?start=src_${ch}`);
      expect(l.store).toBe(`https://shop.frogflow.tech/s/cakes?utm_source=${ch}`);
    }
  });

  it("свои метки: кириллица переводится, негодная — null", () => {
    expect(shareLinks(targets, "блогер Анна")!.bot).toContain("src_bloger_anna");
    expect(shareLinks(targets, "")).toBeNull();
    expect(shareLinks(targets, "ref-anna")).toBeNull(); // «ref-» занято приглашениями друзей
    expect(shareLinks(targets, "a".repeat(41))).toBeNull();
  });

  it("нет бота или витрины — этой ссылки нет, вторая есть", () => {
    expect(shareLinks({ bot: null, store: targets.store }, "instagram")!.bot).toBeNull();
    expect(shareLinks({ bot: "shop_bot", store: null }, "instagram")!.store).toBeNull();
    expect(mainLink(plainLinks({ bot: "@shop_bot", store: null }))).toBe("https://t.me/shop_bot");
    expect(mainLink(plainLinks(targets))).toBe(targets.store);
  });

  it("QR — это SVG", () => {
    expect(qrSvg("https://t.me/shop_bot")).toMatch(/^<svg/);
  });
});

describe("метка источника доходит до покупателя и воронки", () => {
  const botPayload = (url: string) => new URL(url).searchParams.get("start")!;

  it("бот: payload /start из ссылки даёт группу tag:<метка>", () => {
    for (const ch of SHARE_CHANNELS) {
      const payload = botPayload(shareLinks(targets, ch)!.bot!);
      expect(sourceGroup(payload)).toBe(`tag:${ch}`);
    }
  });

  it("витрина: utm_source из ссылки запоминается у покупателя после заказа и даёт ту же группу", async () => {
    for (const ch of SHARE_CHANNELS) {
      const url = new URL(shareLinks(targets, ch)!.store!);
      const source = webSource({ utm_source: url.searchParams.get("utm_source") });
      expect(isWebSource(source)).toBe(true);
      const db = fakeDb();
      db.tables.bot_users = [{ user_key: `u-${ch}`, bot_id: "b", state: {} }];
      const ctx = { tenant: { id: "b" }, db } as never;
      await rememberFirstSource(ctx, { userKey: `u-${ch}` } as never, source);
      const saved = (db.tables.bot_users![0]!.state as { first_source?: string }).first_source;
      expect(saved).toBe(`site:${ch}`);
      expect(sourceGroup(saved)).toBe(`tag:${ch}`);
    }
  });

  it("первая ссылка не перезаписывается следующей", async () => {
    const db = fakeDb();
    db.tables.bot_users = [
      { user_key: "u1", bot_id: "b", state: { first_source: "site:instagram" } },
    ];
    const ctx = { tenant: { id: "b" }, db } as never;
    await rememberFirstSource(ctx, { userKey: "u1" } as never, "site:whatsapp");
    expect((db.tables.bot_users![0]!.state as { first_source: string }).first_source).toBe(
      "site:instagram",
    );
  });
});
