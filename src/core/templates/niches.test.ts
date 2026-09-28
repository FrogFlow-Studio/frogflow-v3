import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { applyNicheTemplate, templateAvailable } from "./apply.server";
import { COURSE_EXAMPLE, EXAMPLE_PREFIX, NICHE_TEMPLATES } from "./niches";
import { courseKey, courseProblem, parseCourse } from "@/core/courses/course";

describe("шаблоны ниш", () => {
  it("у каждой ниши есть шаблон, товары ссылаются на свои категории", () => {
    for (const v of VERTICAL_KEYS) {
      const tpl = NICHE_TEMPLATES[v];
      // У онлайн-школы главный пример — курс (COURSE_EXAMPLE), товаров-файлов нет.
      if (v === "courses") expect(tpl.categories.length).toBeGreaterThan(0);
      else expect(tpl.products.length).toBeGreaterThan(0);
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

function ctxFor(
  vertical: "confectionery" | "digital" | "courses",
  locale?: "kk",
  modules: Record<string, boolean> = {},
) {
  const db = fakeDb();
  const ctx = {
    db,
    tenant: { id: "t1", vertical, modules, settings: locale ? { default_locale: locale } : {} },
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

describe("шаблон «Курсы»", () => {
  it("пример курса проходит проверку курса: уроки с текстом, по расписанию", () => {
    expect(COURSE_EXAMPLE.lessons.length).toBeGreaterThanOrEqual(3);
    for (const l of ["ru", "kk"] as const) {
      expect(COURSE_EXAMPLE.name[l].trim()).not.toBe("");
      for (const lesson of COURSE_EXAMPLE.lessons) {
        expect(lesson.title[l].trim()).not.toBe("");
        expect(lesson.text[l].trim()).not.toBe("");
      }
    }
  });

  it("с модулем курсов шаблон добавляет скрытый цифровой пример курса с уроками", async () => {
    const { db, ctx } = ctxFor("confectionery", undefined, { courses: true });
    const r = await applyNicheTemplate(ctx);
    expect(r.products).toBe(NICHE_TEMPLATES.confectionery.products.length + 1);
    const course = db.tables.products!.find((p) => p.fulfillment_kind === "digital")!;
    expect(course.is_active).toBe(false);
    expect(String(course.name)).toBe(`Пример · ${COURSE_EXAMPLE.name.ru}`);
    const row = db.tables.app_settings!.find((s) => s.key === courseKey(String(course.id)))!;
    const saved = parseCourse(String(row.value));
    expect(saved.schedule).toEqual({ mode: "drip", everyDays: 1 });
    expect(saved.lessons.map((l) => l.title)).toEqual(
      COURSE_EXAMPLE.lessons.map((l) => l.title.ru),
    );
    expect(courseProblem("t1", saved)).toBeNull();
  });

  it("без модуля курсов примера курса нет", async () => {
    const { db, ctx } = ctxFor("digital");
    await applyNicheTemplate(ctx);
    expect(db.tables.app_settings!.some((s) => String(s.key).startsWith("course_"))).toBe(false);
    expect(db.tables.products).toHaveLength(NICHE_TEMPLATES.digital.products.length);
  });
});

describe("шаблон онлайн-школы", () => {
  it("разделы и пример курса с домашним заданием; курс сразу продаётся без файлов", async () => {
    const { db, ctx } = ctxFor("courses", undefined, { courses: true });
    db.tables.app_settings = [];
    const r = await applyNicheTemplate(ctx);
    expect(r.products).toBe(1);
    expect(db.tables.categories!.map((c) => c.name)).toEqual(["Курсы", "Мастер-классы"]);
    const product = db.tables.products![0]!;
    expect(product.file_url).toBe("frogflow:course");
    const saved = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (x) => x.key === courseKey(String(product.id)),
    );
    const course = parseCourse(saved?.value);
    expect(course.lessons.some((l) => l.homework)).toBe(true);
  });
});
