import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder } from "./orders";
import { deliverOrder } from "./deliver-order";
import { saveVariantMaterials } from "@/core/catalog/variant-materials";
import type { MaterialSnapshot } from "@/core/catalog/materials";

const BOT = "00000000-0000-0000-0000-00000000000d";
const TELEGRAM_ID = -424242;
const USER_KEY = "wa_77011234567";

describe("variant digital delivery", () => {
  it("покупатель варианта 5 класс получает ТОЛЬКО файл 5 класса, а не все файлы", async () => {
    const db = fakeDb();
    const productId = "prod-rus";
    const v5Id = "var-5";
    const v6Id = "var-6";

    db.tables.payment_methods = [
      {
        id: "pm-kz",
        bot_id: BOT,
        country_code: "KZ",
        country_name: "Казахстан",
        is_active: true,
        sort_order: 0,
      },
    ];
    db.tables.bot_users = [
      { id: "u1", bot_id: BOT, telegram_id: TELEGRAM_ID, user_key: USER_KEY, state: {} },
    ];
    db.tables.products = [
      {
        id: productId,
        bot_id: BOT,
        name: "Сборники оценивания по русскому языку",
        fulfillment_kind: "digital",
        price: 2500,
        currency: "KZT",
        country_prices: null,
        is_active: true,
        stock_quantity: null,
        product_material_files: [],
      },
    ];
    db.tables.product_variants = [
      { id: v5Id, bot_id: BOT, product_id: productId, name: "5 класс", price: 2500, sort_order: 0 },
      { id: v6Id, bot_id: BOT, product_id: productId, name: "6 класс", price: 2500, sort_order: 1 },
    ];
    db.tables.cart_items = [
      {
        id: "ci-1",
        bot_id: BOT,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: productId,
        product_variant_id: v5Id,
        quantity: 1,
        created_at: "2026-10-21T00:00:00Z",
        products: { ...db.tables.products[0] },
        product_variants: { id: v5Id, name: "5 класс", price: 2500 },
      },
    ];

    const rpc = async (name: string, args: Record<string, unknown>) => {
      await Promise.resolve();
      if (name !== "claim_order_placement") return db.rpc(name, args);
      const user = db.tables.bot_users!.find((u) => u.telegram_id === args.p_telegram_id);
      const state = (user?.state ?? {}) as Record<string, unknown>;
      if (!user || state.placing_order === true) return { data: false, error: null };
      user.state = { ...state, placing_order: true };
      return { data: true, error: null };
    };

    const ctx = {
      tenant: { id: BOT, modules: { digital_delivery: true }, settings: { default_locale: "ru" } },
      db: { from: db.from, rpc } as unknown as FakeDb,
    } as unknown as TenantContext;

    // Сохраняем файлы по вариантам
    await saveVariantMaterials(ctx, productId, {
      [v5Id]: { filePath: "bot/5_klass_rus.pdf", fileName: "5 класс Оценивание.pdf" },
      [v6Id]: { filePath: "bot/6_klass_rus.pdf", fileName: "6 класс Оценивание.pdf" },
    });

    const customer: Customer = {
      userKey: USER_KEY,
      platform: "whatsapp",
      telegramId: TELEGRAM_ID,
      state: { locale: "ru", phone: "+77011234567" },
    } as unknown as Customer;

    const placed = await placeOrder(ctx, customer, "KZ");
    expect(placed.ok).toBe(true);

    if (!placed.ok) throw new Error("Order placement failed");
    const orderId = placed.order.id;
    const items = db.tables.order_items!.filter((it) => it.order_id === orderId);
    expect(items.length).toBe(1);

    const item = items[0]!;
    expect(item.product_variant_id).toBe(v5Id);
    expect(item.file_path_snapshot).toBe("bot/5_klass_rus.pdf");
    expect(item.file_name_snapshot).toBe("5 класс Оценивание.pdf");

    const byLang = (
      typeof item.material_files_by_lang === "string"
        ? JSON.parse(item.material_files_by_lang)
        : item.material_files_by_lang
    ) as Record<string, MaterialSnapshot[]>;
    expect(byLang.ru).toEqual([
      { path: "bot/5_klass_rus.pdf", name: "5 класс Оценивание.pdf", url: null },
    ]);
    expect(byLang.ru?.some((f) => (f.path ?? "").includes("6_klass"))).toBe(false);

    // Доставка покупателю
    const deliveredFiles: MaterialSnapshot[] = [];
    const orderRow = db.tables.orders!.find((o) => o.id === orderId)!;
    orderRow.status = "paid";

    await deliverOrder(
      ctx,
      orderId,
      async (_it, materials) => {
        deliveredFiles.push(...materials);
        return "sent";
      },
      { lang: "ru" },
    );

    expect(deliveredFiles.length).toBe(1);
    expect(deliveredFiles[0]?.path).toBe("bot/5_klass_rus.pdf");
    expect(deliveredFiles[0]?.name).toBe("5 класс Оценивание.pdf");
  });
});
