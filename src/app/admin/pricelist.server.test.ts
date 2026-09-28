import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";

const removed: string[][] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        remove: async (keys: string[]) => {
          removed.push(keys);
          return { data: null, error: null };
        },
      }),
    },
  }),
}));

const {
  addProductMedia,
  deleteProductMedia,
  importPricelist,
  pricelistOverview,
  savePricelistArticles,
  savePricelistSettings,
  setManualRate,
} = await import("./pricelist.server");

/**
 * «Прайс консультанта» в админке (перенос панели BOVI v1): выгрузка 1С,
 * синонимы и бутик, ручной курс, фотобаза, статьи. Только при включённом
 * операторе режиме «по прайсу».
 */
let n = 0;
function ctxOf(on = true): TenantContext {
  const id = `10000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  return {
    tenant: {
      id,
      name: "BOVI",
      settings: settingsFromJson(on ? { consultant_pricelist: { enabled: true } } : {}),
      modules: {},
      vertical: "consultant",
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

const CSV = [
  "Номенклатура;;;;;Розничная;;",
  ";;;;;Цена;;Остаток",
  "Aquanova (Бельгия);;;;;;;",
  "Коврики;;;;;;;",
  "Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый;;;;;47,000   KZT;;1",
  "Uchino (Япония);;;;;;;",
  "Полотенца;;;;;;;",
  "Uchino Полотенце махровое Zero Twist 70x140, белый;;;;;21,000   KZT;;4",
].join("\n");

describe("прайс консультанта в админке", () => {
  it("магазину без режима по прайсу страница закрыта", async () => {
    await expect(pricelistOverview(ctxOf(false))).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
  });

  it("выгрузка 1С заменяет прайс, сводка — продавцу", async () => {
    const ctx = ctxOf();
    const r = await importPricelist(ctx, CSV, "остатки.csv");
    expect(r.meta).toMatchObject({ count: 2, source: "остатки.csv" });
    const o = await pricelistOverview(ctx);
    expect(o.count).toBe(2);
    expect(o.meta?.count).toBe(2);
  });

  it("файл без позиций прайс не стирает", async () => {
    const ctx = ctxOf();
    await importPricelist(ctx, CSV, "a.csv");
    await expect(importPricelist(ctx, "просто текст", "b.csv")).rejects.toMatchObject({
      key: "err.pricelist.empty",
    });
    expect((await pricelistOverview(ctx)).count).toBe(2);
  });

  it("синонимы, сайт и бутик сохраняются; сайт только https", async () => {
    const ctx = ctxOf();
    await savePricelistSettings(ctx, {
      synonyms: "pip, голландские, голландия\n\nuchino, японские",
      shopUrl: "https://bovi.kz",
      store: { address: "Сатпаева, 3", phone: "+7 777 333 08 08", hours: "10–22" },
    });
    const o = await pricelistOverview(ctx);
    expect(o.synonyms).toBe("pip, голландские, голландия\nuchino, японские");
    expect(o.store.address).toBe("Сатпаева, 3");
    await expect(
      savePricelistSettings(ctx, {
        synonyms: "",
        shopUrl: "javascript:alert(1)",
        store: o.store,
      }),
    ).rejects.toMatchObject({ key: "err.pricelist.badUrl" });
  });

  it("курс вручную — в коридоре правдоподобия", async () => {
    const ctx = ctxOf();
    await setManualRate(ctx, 4.79);
    const o = await pricelistOverview(ctx);
    expect(o.rate).toMatchObject({ rate: 4.79, source: "введён вручную", fresh: true });
    await expect(setManualRate(ctx, 479)).rejects.toMatchObject({ key: "err.pricelist.badRate" });
  });

  it("фото в фотобазу — только файл, выданный этому магазину; удаление убирает и файл", async () => {
    const ctx = ctxOf();
    const key = `${ctx.tenant.id}/0123456789abcdef01234567.jpg`;
    const m = await addProductMedia(ctx, { key, match: "Uchino Zero Twist", color: "белый" });
    expect(m).toMatchObject({ kind: "image", match: "Uchino Zero Twist", color: "белый" });
    const video = await addProductMedia(ctx, {
      key: `${ctx.tenant.id}/0123456789abcdef0123456a.mp4`,
      match: "Uchino Zero Twist",
    });
    expect(video.kind).toBe("video");
    const o = await pricelistOverview(ctx);
    expect(o.media).toHaveLength(2);
    expect(o.media[0]!.url).toMatch(new RegExp(`^https://app\\.test/api/img/${ctx.tenant.id}/`));

    await expect(
      addProductMedia(ctx, { key: "other-bot/0123456789abcdef01234567.jpg", match: "x" }),
    ).rejects.toMatchObject({ key: "err.pricelist.badFile" });

    await deleteProductMedia(ctx, m.id);
    expect((await pricelistOverview(ctx)).media).toHaveLength(1);
    expect(removed.at(-1)).toEqual([key]);
  });

  it("статьи базы знаний: пустые отбрасываются", async () => {
    const ctx = ctxOf();
    const r = await savePricelistArticles(ctx, [
      { title: "Uchino", content: "Японская марка, махра из хлопка." },
      { title: "", content: "без заголовка" },
    ]);
    expect(r.count).toBe(1);
    const o = await pricelistOverview(ctx);
    expect(o.articles.map((a) => a.title)).toEqual(["Uchino"]);
  });
});
