import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { readZip } from "../../../tests/zip-reader";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { roleAllows } from "@/core/auth/roles";
import { CONTACTS_MIN_ROLE, allDataZip } from "./export";

const SHOP = "shop-1";
const OTHER = "shop-2";
let db: FakeDb;
const ctx = () =>
  ({ tenant: { id: SHOP }, db, timezone: "Asia/Almaty" }) as unknown as TenantContext;

const order = (id: number, bot_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  bot_id,
  order_no: id,
  display_no: id,
  created_at: new Date(Date.UTC(2026, 8, 1) + id * 60_000).toISOString(),
  status: "delivered",
  total: 1000,
  paid_amount: 0,
  currency: "KZT",
  telegram_id: 100 + (id % 50),
  display_name: "Анна",
  fulfillment_kind: "digital",
  ...extra,
});

async function archive() {
  const { zip, counts } = await allDataZip(ctx(), new Date("2026-09-27T07:00:00Z"));
  const files = Object.fromEntries(readZip(zip).map((f) => [f.name, f.data.toString("utf8")]));
  const rows = (name: string) => files[name]!.replace(/^\uFEFF/, "").split("\r\n");
  return { files, counts, rows };
}

beforeEach(() => {
  // Потолок ответа, как у Supabase: без постраничного чтения часть строк пропала бы.
  db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [
    ...Array.from({ length: 1200 }, (_, i) => order(i + 1, SHOP)),
    order(5001, OTHER, { display_name: "Чужой покупатель" }),
  ];
  db.tables.order_items = [
    ...Array.from({ length: 1200 }, (_, i) => ({
      id: `it-${i}`,
      // У старых позиций v1 bot_id пустой — магазин задаёт номер заказа.
      bot_id: i % 2 ? SHOP : null,
      order_id: i + 1,
      name_snapshot: "Прописи",
      quantity: 2,
      price_snapshot: 500,
      product_id: null,
      delivered_language: "ru",
    })),
    {
      id: "it-other",
      bot_id: OTHER,
      order_id: 5001,
      name_snapshot: "Чужой товар",
      quantity: 1,
      price_snapshot: 1,
      product_id: null,
      delivered_language: null,
    },
  ];
  db.tables.bot_users = [
    ...Array.from({ length: 1100 }, (_, i) => ({
      bot_id: SHOP,
      user_key: `tg_${i}`,
      telegram_id: i,
      first_name: `Покупатель ${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    })),
    {
      bot_id: SHOP,
      user_key: "tg_evil",
      telegram_id: 9999,
      first_name: '=HYPERLINK("http://evil","жми")',
      last_name: "@SUM(1)",
      contact_phone: "+7 700 000 00 00",
      username: "-2+3",
      created_at: "2026-02-01T00:00:00Z",
    },
    { bot_id: OTHER, user_key: "tg_x", telegram_id: 1, first_name: "Чужой покупатель" },
  ];
  db.tables.products = [
    { id: "p1", bot_id: SHOP, name: "Прописи", price: 500, sort_order: 0, is_active: true },
    { id: "p2", bot_id: OTHER, name: "Чужой товар", price: 1, sort_order: 0, is_active: true },
  ];
  db.tables.categories = [];
});

describe("полная выгрузка магазина одним архивом", () => {
  it("в архиве четыре CSV, все строки своего магазина — больше потолка в 1000", async () => {
    const { files, counts, rows } = await archive();
    expect(Object.keys(files)).toEqual([
      "orders.csv",
      "order_items.csv",
      "customers.csv",
      "products.csv",
    ]);
    expect(counts).toEqual({
      "orders.csv": 1200,
      "order_items.csv": 1200,
      "customers.csv": 1101,
      "products.csv": 1,
    });
    // Заголовок плюс строки.
    expect(rows("orders.csv")).toHaveLength(1201);
    expect(rows("order_items.csv")).toHaveLength(1201);
    expect(rows("order_items.csv")[1]).toBe("1200;Прописи;2;500;1000;;ru");
  });

  it("чужой магазин в архив не попадает", async () => {
    const { files } = await archive();
    const all = Object.values(files).join("\n");
    expect(all).not.toContain("Чужой");
    expect(all).not.toContain("5001");
  });

  it("поля покупателя, похожие на формулу, экранируются", async () => {
    const { rows } = await archive();
    const evil = rows("customers.csv").find((r) => r.includes("HYPERLINK"))!;
    const cells = evil.split(";");
    expect(cells[2]).toBe(`"'=HYPERLINK(""http://evil"",""жми"")"`);
    expect(cells[3]).toBe("'@SUM(1)");
    expect(cells[4]).toBe("'-2+3");
    expect(cells[5]).toBe("'+7 700 000 00 00");
    expect(rows("customers.csv").some((r) => /(^|;)[=+\-@]/.test(r))).toBe(false);
  });

  it("архив скачивает владелец или менеджер, но не роль «просмотр»", () => {
    expect(roleAllows("owner", CONTACTS_MIN_ROLE)).toBe(true);
    expect(roleAllows("manager", CONTACTS_MIN_ROLE)).toBe(true);
    expect(roleAllows("viewer", CONTACTS_MIN_ROLE)).toBe(false);
  });
});

describe("выгрузка заказов для бухгалтера", () => {
  it("без колонок и значений, по которым можно найти покупателя", async () => {
    const { ordersCsv, ORDER_CONTACT_COLUMNS } = await import("./export");
    db.tables.orders = [
      order(1, SHOP, {
        display_name: "Анна Иванова",
        username: "anna_iv",
        contact: "+7 700 111 22 33",
        customer_email: "anna@example.com",
        admin_note: "звонить вечером",
        fulfillment_address: "ул. Абая, 1",
        fulfillment_note: "домофон 12",
      }),
    ];
    const full = (await ordersCsv(ctx())).csv;
    const { csv, count } = await ordersCsv(ctx(), { noContacts: true });
    expect(count).toBe(1);
    const header = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")[0]!
      .split(";");
    for (const col of ORDER_CONTACT_COLUMNS) expect(header).not.toContain(col);
    expect(header).toEqual(expect.arrayContaining(["Номер", "Сумма", "Внесено", "Статус"]));
    for (const secret of [
      "Анна Иванова",
      "anna_iv",
      "700 111",
      "anna@example.com",
      "Абая",
      "домофон",
      "звонить",
      "101",
    ])
      expect(csv).not.toContain(secret);
    // Владельцу — как раньше, с контактами.
    expect(full).toContain("anna@example.com");
    expect(full).toContain("Анна Иванова");
  });
});
