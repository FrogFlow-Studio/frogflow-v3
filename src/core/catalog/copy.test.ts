import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey } from "@/core/courses/course";
import { fakeDb } from "../../../tests/fake-db";

const copies: Array<[string, string, string]> = [];
const removed: Array<[string, string[]]> = [];
let failCopyAt = Infinity;
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        copy: async (from: string, to: string) => {
          if (copies.length + 1 >= failCopyAt)
            return { data: null, error: { message: "нет места" } };
          copies.push([bucket, from, to]);
          return { data: null, error: null };
        },
        remove: async (keys: string[]) => {
          removed.push([bucket, keys]);
          return { data: null, error: null };
        },
      }),
    },
  }),
}));

import { copyName, copyProduct } from "./copy";

const T = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V1 = "bbbbbbbb-0000-4000-8000-000000000001";
const V2 = "bbbbbbbb-0000-4000-8000-000000000002";
const L1 = "cccccccc-0000-4000-8000-000000000001";
const C1 = "dddddddd-0000-4000-8000-000000000001";

function setup(modules: Record<string, boolean> = { courses: true }) {
  const db = fakeDb();
  db.tables.products = [
    {
      id: P,
      bot_id: T,
      name: "Курс по акварели",
      description: "О курсе",
      keywords: "акварель",
      price: 15000,
      currency: "KZT",
      country_prices: { KZ: 15000 },
      category_ids: ["cat-1"],
      category_id: null,
      is_active: true,
      sort_order: 3,
      fulfillment_kind: "digital",
      stock_quantity: 7,
      lead_time_days: null,
      file_url: "frogflow:course",
      file_path: null,
      file_name: null,
      file_url_kz: null,
      file_path_kz: null,
      file_name_kz: null,
      rating_avg: 4.8,
      rating_count: 12,
      created_at: "2026-09-01T00:00:00Z",
    },
  ];
  db.tables.product_images = [
    {
      id: "i1",
      bot_id: T,
      product_id: P,
      image_path: `${T}/aaaaaaaaaaaaaaaaaaaaaaaa.jpg`,
      sort_order: 0,
    },
    { id: "i2", bot_id: T, product_id: P, image_path: "legacy/v1-photo.jpg", sort_order: 1 },
  ];
  db.tables.product_material_files = [
    {
      id: "m1",
      bot_id: T,
      product_id: P,
      language: "ru",
      file_path: `${T}/bbbbbbbbbbbbbbbbbbbbbbbb.pdf`,
      file_name: "guide.pdf",
      sort_order: 0,
    },
  ];
  db.tables.product_variants = [
    { id: V1, bot_id: T, product_id: P, name: "Сам", price: 15000, sort_order: 0 },
    { id: V2, bot_id: T, product_id: P, name: "С проверкой", price: 25000, sort_order: 1 },
  ];
  db.tables.app_settings = [
    {
      bot_id: T,
      key: courseKey(P),
      value: JSON.stringify({
        schedule: { mode: "drip", everyDays: 2 },
        lessons: [
          {
            id: L1,
            title: "Урок 1",
            text: "Текст",
            files: [{ path: `${T}/cccccccccccccccccccccccc.pdf`, name: "l1.pdf" }],
            link: null,
          },
        ],
        cohorts: [{ id: C1, title: "Октябрь", start: "2026-10-05T10:00", enrollUntil: null }],
        channel: "@school_channel",
        homeworkDays: 5,
        tariffs: { [V2]: { homework: true, channel: false, accessDays: 90 } },
      }),
    },
  ];
  const ctx = { tenant: { id: T, modules }, db } as unknown as TenantContext;
  return { ctx, db };
}

beforeEach(() => {
  copies.length = 0;
  removed.length = 0;
  failCopyAt = Infinity;
});

describe("копия подписочного товара", () => {
  it("период подписки переезжает к копии, у исходного не меняется", async () => {
    const { ctx, db } = setup({});
    db.tables.app_settings!.push({
      bot_id: T,
      key: `product_subscription:${P}`,
      value: JSON.stringify({ days: 30 }),
    });
    const id = await copyProduct(ctx, P, "— копия");
    const row = db.tables.app_settings!.find((r) => r.key === `product_subscription:${id}`);
    expect(JSON.parse(String(row!.value))).toEqual({ days: 30 });
    expect(
      JSON.parse(
        String(db.tables.app_settings!.find((r) => r.key === `product_subscription:${P}`)!.value),
      ),
    ).toEqual({ days: 30 });
  });

  it("у разового товара записи периода у копии нет", async () => {
    const { ctx, db } = setup({});
    const id = await copyProduct(ctx, P, "— копия");
    expect(db.tables.app_settings!.some((r) => r.key === `product_subscription:${id}`)).toBe(false);
  });
});

describe("копия товара с себестоимостью", () => {
  it("себестоимость переезжает к копии, у исходного не меняется; без модуля — нет", async () => {
    const raw = JSON.stringify({ p: 100, v: { "1 кг": 80 }, cur: "KZT" });
    const { ctx, db } = setup({});
    (ctx.tenant.modules as Record<string, boolean>).profit = true;
    db.tables.app_settings!.push({ bot_id: T, key: `cost:${P}`, value: raw });
    const id = await copyProduct(ctx, P, "— копия");
    expect(db.tables.app_settings!.find((r) => r.key === `cost:${id}`)?.value).toBe(raw);
    expect(db.tables.app_settings!.find((r) => r.key === `cost:${P}`)?.value).toBe(raw);
    (ctx.tenant.modules as Record<string, boolean>).profit = false;
    const id2 = await copyProduct(ctx, P, "— копия 2");
    expect(db.tables.app_settings!.some((r) => r.key === `cost:${id2}`)).toBe(false);
  });
});

describe("копия товара", () => {
  it("название с пометкой не длиннее поля товара", () => {
    expect(copyName("Торт", "— копия")).toBe("Торт — копия");
    expect(copyName("Торт", "")).toBe("Торт");
    expect(copyName("я".repeat(200), "— копия")).toHaveLength(200);
  });

  it("новая скрытая карточка со всеми полями, без продаж и отзывов", async () => {
    const { ctx, db } = setup();
    const id = await copyProduct(ctx, P, "— копия");
    const copy = db.tables.products!.find((p) => p.id === id)!;
    expect(id).not.toBe(P);
    expect(copy).toMatchObject({
      name: "Курс по акварели — копия",
      description: "О курсе",
      keywords: "акварель",
      price: 15000,
      currency: "KZT",
      country_prices: { KZ: 15000 },
      category_ids: ["cat-1"],
      sort_order: 3,
      fulfillment_kind: "digital",
      is_active: false,
      stock_quantity: 0,
    });
    expect(copy.rating_avg ?? null).toBeNull();
    expect(copy.rating_count ?? 0).toBe(0);
    // исходный товар не тронут
    expect(db.tables.products!.find((p) => p.id === P)).toMatchObject({
      is_active: true,
      stock_quantity: 7,
      name: "Курс по акварели",
    });
  });

  it("безлимитный остаток остаётся безлимитным", async () => {
    const { ctx, db } = setup();
    db.tables.products![0]!.stock_quantity = null;
    const id = await copyProduct(ctx, P, "— копия");
    expect(db.tables.products!.find((p) => p.id === id)!.stock_quantity).toBeNull();
  });

  it("картинки, файлы и варианты — свои строки; файлы клиента копируются в новые ключи", async () => {
    const { ctx, db } = setup();
    const id = await copyProduct(ctx, P, "— копия");
    const images = db.tables.product_images!.filter((r) => r.product_id === id);
    expect(images.map((r) => r.sort_order)).toEqual([0, 1]);
    expect(images[0]!.image_path).not.toBe(`${T}/aaaaaaaaaaaaaaaaaaaaaaaa.jpg`);
    expect(String(images[0]!.image_path).startsWith(`${T}/`)).toBe(true);
    // ключ v1 без префикса клиента остаётся ссылкой: его удаление товара не трогает
    expect(images[1]!.image_path).toBe("legacy/v1-photo.jpg");
    const files = db.tables.product_material_files!.filter((r) => r.product_id === id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ language: "ru", file_name: "guide.pdf" });
    expect(files[0]!.file_path).not.toBe(`${T}/bbbbbbbbbbbbbbbbbbbbbbbb.pdf`);
    const variants = db.tables.product_variants!.filter((r) => r.product_id === id);
    expect(variants.map((v) => [v.name, v.price])).toEqual([
      ["Сам", 15000],
      ["С проверкой", 25000],
    ]);
    expect(copies.map(([b, from]) => [b, from])).toEqual([
      ["product-images", `${T}/aaaaaaaaaaaaaaaaaaaaaaaa.jpg`],
      ["product-files", `${T}/bbbbbbbbbbbbbbbbbbbbbbbb.pdf`],
      ["product-files", `${T}/cccccccccccccccccccccccc.pdf`],
    ]);
  });

  it("курс копируется с уроками и тарифами по новым вариантам, без потоков и канала", async () => {
    const { ctx, db } = setup();
    const id = await copyProduct(ctx, P, "— копия");
    const row = db.tables.app_settings!.find((r) => r.key === courseKey(id));
    const c = JSON.parse(String(row!.value));
    expect(c.schedule).toEqual({ mode: "drip", everyDays: 2 });
    expect(c.homeworkDays).toBe(5);
    expect(c.cohorts).toBeUndefined();
    expect(c.channel).toBeUndefined();
    expect(c.lessons).toHaveLength(1);
    expect(c.lessons[0].files[0].path).not.toBe(`${T}/cccccccccccccccccccccccc.pdf`);
    const newV2 = db.tables.product_variants!.find(
      (v) => v.product_id === id && v.name === "С проверкой",
    )!;
    expect(c.tariffs).toEqual({
      [newV2.id as string]: { homework: true, channel: false, accessDays: 90 },
    });
    // метка курса на копии есть, и курс исходного товара не тронут
    expect(db.tables.products!.find((p) => p.id === id)!.file_url).toBe("frogflow:course");
    expect(
      JSON.parse(String(db.tables.app_settings!.find((r) => r.key === courseKey(P))!.value))
        .cohorts,
    ).toHaveLength(1);
  });

  it("без модуля курсов уроки не копируются", async () => {
    const { ctx, db } = setup({});
    const id = await copyProduct(ctx, P, "— копия");
    expect(db.tables.app_settings!.some((r) => r.key === courseKey(id))).toBe(false);
  });

  it("файл урока другого клиента — отказ и откат копии", async () => {
    const { ctx, db } = setup();
    const row = db.tables.app_settings![0]!;
    const c = JSON.parse(String(row.value));
    c.lessons[0].files = [{ path: `${OTHER}/x.pdf`, name: null }];
    row.value = JSON.stringify(c);
    await expect(copyProduct(ctx, P, "— копия")).rejects.toBeDefined();
    // откат: строки копии нет
    expect(db.tables.products!.map((p) => p.id)).toEqual([P]);
  });

  it("сбой копирования файла откатывает копию: строки, новые файлы", async () => {
    const { ctx, db } = setup();
    failCopyAt = 2;
    await expect(copyProduct(ctx, P, "— копия")).rejects.toMatchObject({
      name: expect.any(String),
    });
    expect(db.tables.products!.map((p) => p.id)).toEqual([P]);
    expect(removed).toEqual([["product-images", [copies[0]![2]]]]);
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual([courseKey(P)]);
  });

  it("товара нет — отказ с ключом, ничего не создано", async () => {
    const { ctx, db } = setup();
    await expect(
      copyProduct(ctx, "ffffffff-0000-4000-8000-000000000000", "— копия"),
    ).rejects.toMatchObject({ key: "err.catalog.copyNotFound" });
    expect(db.tables.products).toHaveLength(1);
  });
});
