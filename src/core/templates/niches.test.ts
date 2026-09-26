import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { applyNicheTemplate, templateAvailable } from "./apply.server";
import { EXAMPLE_PREFIX, NICHE_TEMPLATES } from "./niches";

describe("шаблоны ниш", () => {
  it("у каждой ниши есть шаблон, товары ссылаются на свои категории", () => {
    for (const v of VERTICAL_KEYS) {
      const tpl = NICHE_TEMPLATES[v];
      expect(tpl.products.length).toBeGreaterThan(0);
      for (const p of tpl.products) {
        expect(tpl.categories[p.category]).toBeDefined();
        for (const l of ["ru", "kk"] as const) {
          expect(p.name[l].trim()).not.toBe("");
          expect(p.description[l].trim()).not.toBe("");
          expect((EXAMPLE_PREFIX[l] + p.name[l]).length).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it("тип товара в шаблоне совпадает с умолчанием ниши", () => {
    for (const v of VERTICAL_KEYS)
      for (const p of NICHE_TEMPLATES[v].products)
        expect(p.kind).toBe(VERTICALS[v].defaultFulfillment);
  });
});

function ctxFor(vertical: "confectionery" | "digital", locale?: "kk") {
  const db = fakeDb();
  const ctx = {
    db,
    tenant: { id: "t1", vertical, settings: locale ? { default_locale: locale } : {} },
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("применение шаблона", () => {
  it("кладёт категории и скрытые примеры с пометкой, один раз", async () => {
    const { db, ctx } = ctxFor("confectionery");
    expect(await templateAvailable(ctx)).toBe(true);
    const r = await applyNicheTemplate(ctx);
    expect(r.products).toBe(NICHE_TEMPLATES.confectionery.products.length);
    const products = db.tables.products ?? [];
    expect(products.every((p) => p.is_active === false)).toBe(true);
    expect(products.every((p) => String(p.name).startsWith("Пример · "))).toBe(true);
    expect(products[0]!.currency).toBe("KZT");
    expect(products[0]!.lead_time_days).toBe(2);
    const cats = (db.tables.categories ?? []).map((c) => c.id);
    expect(products.every((p) => cats.includes((p.category_ids as string[])[0]))).toBe(true);
    await expect(applyNicheTemplate(ctx)).rejects.toThrow("только в пустой магазин");
  });

  it("казахский магазин получает казахские тексты", async () => {
    const { db, ctx } = ctxFor("digital", "kk");
    await applyNicheTemplate(ctx);
    expect(String(db.tables.products![0]!.name).startsWith("Үлгі · ")).toBe(true);
    expect(db.tables.categories![0]!.name).toBe("Мектепке дейінгілерге");
  });

  it("в магазин с товарами не кладёт", async () => {
    const { db, ctx } = ctxFor("digital");
    db.tables.products = [{ id: "p1", name: "Свой товар" }];
    expect(await templateAvailable(ctx)).toBe(false);
    await expect(applyNicheTemplate(ctx)).rejects.toThrow();
    expect(db.tables.products).toHaveLength(1);
  });
});
