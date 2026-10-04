import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { readZip } from "../../../tests/zip-reader";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  TAKEOUT_TTL_S,
  checkTakeout,
  exportableSettings,
  takeoutLink,
  takeoutZip,
} from "./takeout";

const SECRET = "test-secret-test-secret-test-secret";
const SHOP = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-10-04T10:00:00Z");

const parts = (path: string) => {
  const u = new URL(`http://x${path}`);
  return { e: u.searchParams.get("e"), k: u.searchParams.get("k") };
};

describe("ссылка «Забрать мои данные»", () => {
  it("действует 24 часа и ни секундой дольше", () => {
    const { path, expiresAt } = takeoutLink(SECRET, SHOP, NOW);
    const { e, k } = parts(path);
    expect(new Date(expiresAt).getTime() - NOW.getTime()).toBe(TAKEOUT_TTL_S * 1000);
    expect(checkTakeout(SECRET, SHOP, e, k, new Date(NOW.getTime() + 3_600_000))).toBe("ok");
    expect(checkTakeout(SECRET, SHOP, e, k, new Date(expiresAt))).toBe("ok");
    expect(checkTakeout(SECRET, SHOP, e, k, new Date(new Date(expiresAt).getTime() + 1000))).toBe(
      "expired",
    );
  });

  it("ссылка одного магазина не открывает архив другого", () => {
    const { e, k } = parts(takeoutLink(SECRET, SHOP, NOW).path);
    expect(checkTakeout(SECRET, OTHER, e, k, NOW)).toBe("invalid");
  });

  it("продлить срок или подпись подделать нельзя", () => {
    const { e, k } = parts(takeoutLink(SECRET, SHOP, NOW).path);
    expect(checkTakeout(SECRET, SHOP, String(Number(e) + 86_400), k, NOW)).toBe("invalid");
    expect(checkTakeout(SECRET, SHOP, e, `${k!.slice(0, -1)}A`, NOW)).toBe("invalid");
    expect(checkTakeout("другой-секрет", SHOP, e, k, NOW)).toBe("invalid");
    expect(checkTakeout(SECRET, SHOP, null, null, NOW)).toBe("invalid");
    expect(checkTakeout(SECRET, SHOP, "abc", "x", NOW)).toBe("invalid");
  });
});

describe("настройки в архиве", () => {
  it("пароли, хеши, токены и ключи не попадают в архив", () => {
    const out = JSON.stringify(
      exportableSettings({
        slug: "shop",
        timezone: "Asia/Almaty",
        admin: { username: "owner", password_hash: "scrypt$abc", users: [{ username: "m" }] },
        zernio: { profile_id: "p1" },
        billing: { plan: "x" },
        vip: { token_enc: "enc:1", username: "vipbot" },
        crm: { webhook_secret: "s3", url: "https://crm.example" },
        telegram: { username: "shop_bot" },
      }),
    );
    expect(out).not.toMatch(/scrypt|enc:1|s3|owner|profile_id|plan/);
    expect(out).toContain("shop_bot");
    expect(out).toContain("vipbot");
    expect(out).toContain("https://crm.example");
    expect(out).toContain("Asia/Almaty");
  });
});

describe("архив", () => {
  it("только данные своего магазина, настройки без секретов, постранично", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.orders = [
      ...Array.from({ length: 1100 }, (_, i) => ({
        id: i + 1,
        bot_id: SHOP,
        order_no: i + 1,
        display_no: i + 1,
        created_at: "2026-09-01T00:00:00Z",
        status: "delivered",
        total: 1000,
        paid_amount: 0,
        currency: "KZT",
        telegram_id: 1,
        display_name: "Анна",
        fulfillment_kind: "digital",
      })),
      { id: 9001, bot_id: OTHER, order_no: 1, display_name: "Чужой покупатель", status: "new" },
    ];
    db.tables.order_items = [];
    db.tables.bot_users = [{ bot_id: OTHER, user_key: "tg_x", first_name: "Чужой покупатель" }];
    db.tables.products = [];
    db.tables.categories = [];
    const ctx = {
      tenant: {
        id: SHOP,
        name: "Мой магазин",
        vertical: "courses",
        settings: { slug: "shop", admin: { password_hash: "scrypt$abc" } },
      },
      db,
      timezone: "Asia/Almaty",
    } as unknown as TenantContext;
    const { zip, counts } = await takeoutZip(ctx, NOW);
    const files = Object.fromEntries(readZip(zip).map((f) => [f.name, f.data.toString("utf8")]));
    expect(Object.keys(files)).toEqual([
      "orders.csv",
      "order_items.csv",
      "customers.csv",
      "products.csv",
      "settings.json",
      "README.txt",
    ]);
    expect(counts["orders.csv"]).toBe(1100);
    expect(Object.values(files).join("\n")).not.toContain("Чужой покупатель");
    expect(files["settings.json"]).toContain("Мой магазин");
    expect(files["settings.json"]).not.toContain("scrypt");
  });
});
