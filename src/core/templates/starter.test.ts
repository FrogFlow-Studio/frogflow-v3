import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { VERTICAL_KEYS } from "@/core/verticals/registry";
import { applyNicheTemplate, removeStarter, starterLeft, STARTER_KEY } from "./apply.server";
import { NICHE_TEMPLATES } from "./niches";

/** Стартовый набор после регистрации: id созданного, гонка двух вызовов, «Убрать примеры». */
function shop(vertical: (typeof VERTICAL_KEYS)[number] = "digital") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const ctx = {
    db,
    tenant: { id: "t1", vertical, modules: {}, settings: {} },
  } as unknown as TenantContext;
  return { db, ctx };
}
const setting = (db: ReturnType<typeof fakeDb>, key: string) =>
  (db.tables.app_settings ?? []).find((r) => r.key === key)?.value as string | undefined;

describe("стартовый набор: что кладётся", () => {
  it.each(VERTICAL_KEYS)("ниша %s: категории и скрытые примеры, id записаны", async (vertical) => {
    const { db, ctx } = shop(vertical);
    await applyNicheTemplate(ctx);
    const ids = JSON.parse(setting(db, STARTER_KEY)!) as {
      categories: string[];
      products: string[];
    };
    expect(ids.categories.sort()).toEqual(
      (db.tables.categories ?? []).map((c) => String(c.id)).sort(),
    );
    expect(ids.products.sort()).toEqual((db.tables.products ?? []).map((p) => String(p.id)).sort());
    expect(ids.categories.length).toBe(NICHE_TEMPLATES[vertical].categories.length);
    expect((db.tables.products ?? []).every((p) => p.is_active === false)).toBe(true);
    expect(await starterLeft(ctx, setting(db, STARTER_KEY)!)).toBe(ids.products.length);
  });
});

describe("стартовый набор: гонка и сбой", () => {
  it("два вызова одновременно (повтор регистрации, двойной клик) — один набор", async () => {
    const { db, ctx } = shop("confectionery");
    const r = await Promise.allSettled([applyNicheTemplate(ctx), applyNicheTemplate(ctx)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(db.tables.products).toHaveLength(NICHE_TEMPLATES.confectionery.products.length);
    expect(db.tables.categories).toHaveLength(NICHE_TEMPLATES.confectionery.categories.length);
  });

  it("сбой посередине: созданное убрано, отметка снята — набор можно повторить", async () => {
    const { db, ctx } = shop("digital");
    const real = db.from.bind(db);
    let n = 0;
    db.from = ((t: string) =>
      t === "categories" && ++n === 2
        ? {
            insert: () => ({
              select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }
        : real(t)) as typeof db.from;
    await expect(applyNicheTemplate(ctx)).rejects.toThrow("boom");
    expect(db.tables.categories ?? []).toHaveLength(0);
    expect(db.tables.products ?? []).toHaveLength(0);
    db.from = real;
    await applyNicheTemplate(ctx);
    expect(db.tables.products).toHaveLength(NICHE_TEMPLATES.digital.products.length);
  });
});

describe("«Убрать примеры»", () => {
  it("удаляет созданное набором и не трогает товары и категории продавца", async () => {
    const { db, ctx } = shop("digital");
    await applyNicheTemplate(ctx);
    db.tables.categories!.push({ id: "mine-c", bot_id: "t1", name: "Своя", parent_id: null });
    db.tables.products!.push({
      id: "mine-p",
      bot_id: "t1",
      name: "Мой товар",
      is_active: true,
      category_ids: ["mine-c"],
    });
    const r = await removeStarter(ctx);
    expect(r).toEqual({ removed: NICHE_TEMPLATES.digital.products.length, kept: 0 });
    expect(db.tables.products!.map((p) => p.id)).toEqual(["mine-p"]);
    expect(db.tables.categories!.map((c) => c.id)).toEqual(["mine-c"]);
    expect(setting(db, STARTER_KEY)).toBe("");
    expect(await removeStarter(ctx)).toEqual({ removed: 0, kept: 0 });
  });

  it("пример, который продавец включил, и категория с его товаром остаются", async () => {
    const { db, ctx } = shop("digital");
    await applyNicheTemplate(ctx);
    const first = db.tables.products![0]!;
    first.is_active = true;
    const r = await removeStarter(ctx);
    expect(r.kept).toBe(1);
    expect(db.tables.products!.map((p) => p.id)).toEqual([first.id]);
    const cat = (first.category_ids as string[])[0];
    expect(db.tables.categories!.map((c) => c.id)).toEqual([cat]);
    expect(await starterLeft(ctx, setting(db, STARTER_KEY) ?? "")).toBe(0);
  });

  it("повторное нажатие после уже удалённых примеров ничего не ломает", async () => {
    const { db, ctx } = shop("digital");
    await applyNicheTemplate(ctx);
    const saved = setting(db, STARTER_KEY)!;
    await removeStarter(ctx);
    db.tables.app_settings!.find((r) => r.key === STARTER_KEY)!.value = saved;
    expect(await removeStarter(ctx)).toEqual({
      removed: 0,
      kept: NICHE_TEMPLATES.digital.products.length,
    });
    expect(db.tables.products).toHaveLength(0);
  });
});
