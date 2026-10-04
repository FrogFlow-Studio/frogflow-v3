import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/** Страница итогов розыгрыша: клиент прежней платформы, архив, выключенный модуль и чужой id — «не найден». */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
const BOT = "22222222-2222-2222-2222-222222222222";
let tenant: Tenant;
const db = fakeDb();
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: (t: Tenant) => ({ tenant: t, db, timezone: "Asia/Almaty" }),
}));

const { storeGiveawayFn } = await import("./giveaway.functions");
const base = {
  id: BOT,
  archived: false,
  modules: { shop: true, giveaways: true },
  settings: { served_by: "v2", slug: "shop" },
} as unknown as Tenant;
const ID = "abcd1234";

function seed() {
  db.tables.zernio_logs = [
    {
      bot_id: BOT,
      event_id: `giveaway:${ID}:entry:tg_1`,
      event_type: "giveaway.entry",
      status: "event",
      payload: { user_key: "tg_1" },
    },
  ];
  db.tables.bot_users = [];
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: `giveaway:${ID}`,
      value: JSON.stringify({
        id: ID,
        rev: 1,
        title: "Осень",
        prize: "Открытки",
        channel: "telegram",
        conditions: "",
        endsAt: "2026-10-11T10:00:00.000Z",
        winners: 1,
        status: "open",
      }),
      updated_at: "2026-10-04T10:00:00.000Z",
    },
  ];
}

describe("страница итогов розыгрыша", () => {
  it("открытый модуль и свой id — данные розыгрыша", async () => {
    seed();
    tenant = base;
    const g = await storeGiveawayFn({ data: { slug: "shop", id: ID } });
    expect(g).toMatchObject({ id: ID, title: "Осень", entered: 1, result: null });
  });

  it("нет такого розыгрыша — «не найден»", async () => {
    seed();
    tenant = base;
    await expect(storeGiveawayFn({ data: { slug: "shop", id: "zzzzzzzz" } })).rejects.toBeTruthy();
  });

  it.each([
    ["клиент прежней платформы", { ...base, settings: { slug: "shop" } }],
    ["архив", { ...base, archived: true }],
    ["модуль giveaways выключен", { ...base, modules: { shop: true } }],
    ["нет магазина", { ...base, modules: { giveaways: true } }],
  ])("%s — «не найден»", async (_n, t) => {
    seed();
    tenant = t as unknown as Tenant;
    await expect(storeGiveawayFn({ data: { slug: "shop", id: ID } })).rejects.toBeTruthy();
  });
});
