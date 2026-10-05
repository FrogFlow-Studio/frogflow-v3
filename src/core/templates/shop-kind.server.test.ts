import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { SHOP_KIND_TEMPLATES, SHOP_KINDS } from "./shop-kinds";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const state = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  failPatch: false,
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  patchTenantSettings: async (_id: string, patch: Record<string, unknown>) => {
    if (state.failPatch) throw new Error("база недоступна");
    state.patches.push(patch);
  },
}));

const { applyShopKind, KIND_LOCK_KEY } = await import("./shop-kind.server");

let db: FakeDb;
const ctx = (settings: Record<string, unknown> = {}) =>
  ({
    tenant: { id: BOT, vertical: "digital", settings: { default_locale: "ru", ...settings } },
    db,
  }) as never;
const setting = (key: string) =>
  (db.tables.app_settings ?? []).find((r) => r.key === key)?.value as string | undefined;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  state.patches = [];
  state.failPatch = false;
});

describe("шаблон магазина по типу", () => {
  it("в пустой магазин кладёт категории, тексты, выдачу и оплату", async () => {
    const r = await applyShopKind(ctx(), "goods");
    expect(r.categories).toBe(4);
    expect(db.tables.categories!.map((c) => c.name)).toEqual(
      SHOP_KIND_TEMPLATES.goods.categories.map((c) => c.ru),
    );
    expect(state.patches).toHaveLength(1);
    const about = (state.patches[0] as { storefront_about: Record<string, string> })
      .storefront_about;
    expect(Object.keys(about).sort()).toEqual(["delivery", "description", "payment"]);
    expect(setting("fulfillment_pickup_enabled")).toBe("true");
    expect(setting("fulfillment_delivery_enabled")).toBe("true");
    expect(setting("payment_mode")).toBe("full");
    // блокировка снята
    expect(setting(KIND_LOCK_KEY)).toBe("");
  });

  it("цифровые материалы: выдача выключена, и это же написано в тексте про доставку", async () => {
    await applyShopKind(ctx(), "digital");
    expect(setting("fulfillment_delivery_enabled")).toBe("false");
    expect(setting("fulfillment_pickup_enabled")).toBe("false");
    const about = (state.patches[0] as { storefront_about: Record<string, string> })
      .storefront_about;
    expect(about.delivery).toMatch(/не нужна/);
  });

  it("не пустой магазин: есть товар или категория — отказ, ничего не меняется", async () => {
    db.tables.products = [{ id: "p1", bot_id: BOT, name: "Мой товар" }];
    await expect(applyShopKind(ctx(), "goods")).rejects.toMatchObject({
      key: "err.shopKind.notEmpty",
    });
    db.tables.products = [];
    db.tables.categories = [{ id: "c1", bot_id: BOT, name: "Своя" }];
    await expect(applyShopKind(ctx(), "goods")).rejects.toMatchObject({
      key: "err.shopKind.notEmpty",
    });
    expect(db.tables.categories).toHaveLength(1);
    expect(state.patches).toEqual([]);
    expect(setting("payment_mode")).toBeUndefined();
  });

  it("свои тексты и настройки продавца не затираются", async () => {
    db.tables.app_settings = [
      { bot_id: BOT, key: "payment_mode", value: "on_receipt" },
      { bot_id: BOT, key: "fulfillment_delivery_enabled", value: "true" },
    ];
    await applyShopKind(
      ctx({ storefront_about: { delivery: "Только курьер КазПочты" } }),
      "services",
    );
    expect(setting("payment_mode")).toBe("on_receipt");
    expect(setting("fulfillment_delivery_enabled")).toBe("true");
    expect(setting("fulfillment_pickup_enabled")).toBe("false");
    const about = (state.patches[0] as { storefront_about: Record<string, string> })
      .storefront_about;
    expect(about.delivery).toBeUndefined();
    expect(about.description).toBeTruthy();
  });

  it("язык текстов — язык магазина", async () => {
    await applyShopKind(ctx({ default_locale: "en" }), "digital");
    expect(db.tables.categories!.map((c) => c.name)).toContain("Templates");
  });

  it("два одновременных применения: категории ровно один раз", async () => {
    const results = await Promise.allSettled([
      applyShopKind(ctx(), "goods"),
      applyShopKind(ctx(), "goods"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["err.shopKind.busy", "err.shopKind.notEmpty"]).toContain(
      (lost.reason as { key: string }).key,
    );
    expect(db.tables.categories).toHaveLength(4);
  });

  it("проигравший, пришедший после победителя, видит «не пусто», а не кладёт второй набор", async () => {
    await applyShopKind(ctx(), "goods");
    await expect(applyShopKind(ctx(), "goods")).rejects.toMatchObject({
      key: "err.shopKind.notEmpty",
    });
    expect(db.tables.categories).toHaveLength(4);
  });

  it("сбой записи текстов: созданные категории убраны, блокировка снята, можно повторить", async () => {
    state.failPatch = true;
    await expect(applyShopKind(ctx(), "goods")).rejects.toThrow("база недоступна");
    expect(db.tables.categories ?? []).toHaveLength(0);
    expect(setting(KIND_LOCK_KEY)).toBe("");
    state.failPatch = false;
    expect((await applyShopKind(ctx(), "goods")).categories).toBe(4);
  });

  it("все три типа переведены на четыре языка", () => {
    for (const k of SHOP_KINDS) {
      const t = SHOP_KIND_TEMPLATES[k];
      const texts = [...t.categories, t.about.description, t.about.delivery, t.about.payment];
      for (const x of texts)
        for (const l of ["ru", "kk", "en", "uz"] as const)
          expect(x[l].trim().length).toBeGreaterThan(1);
    }
  });
});
