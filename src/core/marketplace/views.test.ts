import { describe, expect, it } from "vitest";
import { MARKET_RECENT_MAX, parseViews, pushView } from "./views";
import { recentItems } from "./feeds.server";
import { fakeDb } from "../../../tests/fake-db";
import type { Db } from "@/core/db/client.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("«Недавно смотрели» на площадке (Л2): только браузер", () => {
  it("последний первым, повтор наверх без дубля, не больше двенадцати, мусор отбрасывается", () => {
    let list = parseViews(null);
    for (let n = 1; n <= 15; n++) list = pushView(list, { slug: "cakes", id: id(n) });
    expect(list).toHaveLength(MARKET_RECENT_MAX);
    expect(list[0]!.id).toBe(id(15));
    list = pushView(list, { slug: "cakes", id: id(10) });
    expect(list[0]!.id).toBe(id(10));
    expect(list.filter((v) => v.id === id(10))).toHaveLength(1);
    expect(parseViews("{oops")).toEqual([]);
    expect(
      parseViews(
        JSON.stringify([
          { slug: "Плохой слаг", id: id(1) },
          { slug: "cakes", id: "x" },
        ]),
      ),
    ).toEqual([]);
  });

  it("сервер отвечает только тем, что есть в снимке показываемых магазинов, в порядке просмотра", async () => {
    const svc = fakeDb();
    svc.tables.marketplace_items = [
      {
        bot_id: "b1",
        product_id: id(1),
        name: "Один",
        price: 1,
        currency: "KZT",
        image: null,
        updated_at: "2026-10-05T10:00:00Z",
      },
      {
        bot_id: "b1",
        product_id: id(2),
        name: "Два",
        price: 2,
        currency: "KZT",
        image: null,
        updated_at: "2026-10-05T10:00:00Z",
      },
      {
        bot_id: "hid",
        product_id: id(3),
        name: "Скрытый",
        price: 3,
        currency: "KZT",
        image: null,
        updated_at: "2026-10-05T10:00:00Z",
      },
    ];
    const shops = new Map([["b1", { slug: "cakes", name: "Лавка" }]]);
    const r = await recentItems(
      shops,
      [
        { slug: "cakes", id: id(2) },
        { slug: "hidden", id: id(3) },
        { slug: "cakes", id: id(9) }, // нет в снимке
        { slug: "cakes", id: id(1) },
      ],
      svc as unknown as Db,
    );
    expect(r.map((i) => i.name)).toEqual(["Два", "Один"]);
  });
});
