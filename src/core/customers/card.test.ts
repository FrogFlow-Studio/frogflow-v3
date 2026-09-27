import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer } from "./customers";
import { cleanTags, customerCard, knownTags, orderStats, setSellerNote, sourceLabel } from "./card";
import { NOTE_PREFIX, readSellerNote } from "./seller-notes";

let db: FakeDb;
const ctx = (modules: Record<string, boolean> = {}) =>
  ({ tenant: { id: "b", modules, settings: {} }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.bot_users = [
    {
      user_key: "tg_5",
      telegram_id: 5,
      platform: "telegram",
      username: "anya",
      first_name: "Аня",
      last_name: null,
      contact_phone: "+77001112233",
      email: null,
      language_code: "ru",
      loyalty_points: 40,
      created_at: "2026-09-01T10:00:00Z",
      opt_out: false,
      // Отметки автоворонки и возврата клиентов лежат рядом — их не трогаем.
      metadata: { funnel: { step: 2 }, winback: { at: "2026-09-20" } },
      state: { locale: "kk", country_name: "Казахстан", first_source: "ref_abc" },
    },
  ];
  db.tables.orders = [
    {
      id: 1,
      order_no: 11,
      display_no: null,
      telegram_id: 5,
      status: "delivered",
      total: 3000,
      currency: "KZT",
      created_at: "2026-09-02T10:00:00Z",
    },
    {
      id: 2,
      order_no: 12,
      display_no: null,
      telegram_id: 5,
      status: "awaiting_payment",
      total: 9000,
      currency: "KZT",
      created_at: "2026-09-10T10:00:00Z",
    },
    {
      id: 3,
      order_no: 13,
      display_no: null,
      telegram_id: 5,
      status: "accepted",
      total: 50,
      currency: "USD",
      created_at: "2026-09-12T10:00:00Z",
    },
    {
      id: 4,
      order_no: 14,
      display_no: null,
      telegram_id: 9,
      status: "delivered",
      total: 1,
      currency: "KZT",
      created_at: "2026-09-12T10:00:00Z",
    },
  ];
});

describe("карточка покупателя: теги и заметка", () => {
  it("теги без пустых, повторов и лишних пробелов", () => {
    expect(cleanTags([" VIP ", "vip", "", "учитель  начальных", 5])).toEqual([
      "VIP",
      "учитель начальных",
    ]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
    expect(cleanTags("vip")).toEqual([]);
  });

  it("заметка — своя строка app_settings, bot_users не трогается", async () => {
    const before = structuredClone(db.tables.bot_users);
    const r = await setSellerNote(ctx(), "tg_5", {
      tags: ["vip", "VIP"],
      note: " звонить после 18 ",
    });
    expect(r).toEqual({ tags: ["vip"], note: "звонить после 18" });
    expect(db.tables.bot_users).toEqual(before);
    expect(db.tables.app_settings!.map((x) => x.key)).toEqual([`${NOTE_PREFIX}tg_5`]);
    expect(await readSellerNote(ctx(), "tg_5")).toEqual({
      tags: ["vip"],
      note: "звонить после 18",
    });
    expect(await setSellerNote(ctx(), "tg_404", { tags: ["x"], note: "" })).toBeNull();
  });

  it("канал, переписавший metadata между чтением и записью, заметку не теряет", async () => {
    db.tables.bot_users!.push({
      user_key: "ig_77",
      telegram_id: 77,
      platform: "instagram",
      metadata: { ig: { name: "старое" } },
      state: {},
    });
    // Входящее из Instagram: upsertCustomer прочитал строку, но его запись
    // metadata целиком задержалась — продавец успел сохранить заметку.
    let release!: () => void;
    let channelWrote = false;
    const gate = new Promise<void>((r) => (release = r));
    const channelDb = new Proxy(db, {
      get(target, prop, recv) {
        if (prop !== "from") return Reflect.get(target, prop, recv);
        return (table: string) => {
          const q = target.from(table);
          if (table !== "bot_users") return q;
          const update = q.update.bind(q);
          q.update = (patch: Record<string, unknown>) => {
            const b = update(patch);
            const then = b.then.bind(b);
            b.then = ((ok, fail) =>
              gate.then(() => {
                channelWrote = true;
                return then(ok, fail);
              })) as typeof b.then;
            return b;
          };
          return q;
        };
      },
    });
    const channelCtx = { tenant: { id: "b", modules: {}, settings: {} }, db: channelDb };
    const incoming = upsertCustomer(channelCtx as unknown as TenantContext, "instagram", "77", {
      metadata: { ig: { name: "новое" } },
    });
    await new Promise((r) => setTimeout(r, 0));
    await setSellerNote(ctx(), "ig_77", { tags: ["опт"], note: "просит счёт" });
    release();
    await incoming;
    expect(channelWrote).toBe(true);
    expect(await readSellerNote(ctx(), "ig_77")).toEqual({ tags: ["опт"], note: "просит счёт" });
  });

  it("пустая заметка без тегов строку удаляет; теги магазина — из всех заметок", async () => {
    await setSellerNote(ctx(), "tg_5", { tags: ["VIP", "опт"], note: "" });
    db.tables.bot_users!.push({ user_key: "tg_6", telegram_id: 6, platform: "telegram" });
    await setSellerNote(ctx(), "tg_6", { tags: ["vip", "учитель"], note: "" });
    expect(await knownTags(ctx())).toEqual(["VIP", "опт", "учитель"]);
    await setSellerNote(ctx(), "tg_6", { tags: [], note: "  " });
    expect(db.tables.app_settings!.map((x) => x.key)).toEqual([`${NOTE_PREFIX}tg_5`]);
  });

  it("токен корзины с витрины продавцу не показывается", () => {
    expect(sourceLabel("wc_4f9a0c1d2e")).toBe("storefront");
    expect(sourceLabel("ref_abc")).toBe("ref_abc");
    expect(sourceLabel(undefined)).toBeNull();
  });
});

describe("карточка покупателя: сводка", () => {
  it("покупки — только оплаченные заказы, суммы по валютам", () => {
    const s = orderStats(db.tables.orders!.filter((o) => o.telegram_id === 5) as never);
    expect(s).toEqual({
      count: 2,
      totals: { KZT: 3000, USD: 50 },
      firstAt: "2026-09-02T10:00:00Z",
      lastAt: "2026-09-12T10:00:00Z",
    });
  });

  it("собирает профиль, заказы только этого покупателя и его заявки", async () => {
    db.tables.app_settings = [
      {
        bot_id: "b",
        key: "crm:lead:11111111-1111-1111-1111-111111111111",
        value: JSON.stringify({
          id: "11111111-1111-1111-1111-111111111111",
          stage: "new",
          name: "Аня",
          contact: "",
          source: "consultant",
          amount: null,
          currency: null,
          note: null,
          owner: null,
          user_key: "tg_5",
          created_at: "2026-09-03T00:00:00Z",
          updated_at: "2026-09-03T00:00:00Z",
          closed_at: null,
        }),
      },
    ];
    const card = await customerCard(ctx({ crm_pipeline: true }), "tg_5");
    expect(card).toMatchObject({
      name: "Аня",
      language: "kk",
      country: "Казахстан",
      points: 40,
      firstSource: "ref_abc",
      blocked: false,
      stats: { count: 2 },
    });
    expect(card!.orders.map((o) => o.no)).toEqual([13, 12, 11]);
    expect(card!.leads).toHaveLength(1);
    expect(card!.tickets).toEqual([]);
    expect(await customerCard(ctx(), "tg_404")).toBeNull();
  });
});
