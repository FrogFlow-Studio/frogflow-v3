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
  addKnowledgeArticles,
  addProductMedia,
  deleteProductMedia,
  importPricelist,
  importPricelistSheetFor,
  previewKnowledgeImport,
  previewPricelistSheetFor,
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

  it("загрузка статей: предпросмотр ничего не пишет, добавление сохраняет прежние", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(ctx, [
      { title: "Uchino", content: "Японская марка." },
      { title: "Доставка", content: "По Алматы бесплатно." },
    ]);
    const pre = await previewKnowledgeImport(ctx, {
      text: "### Доставка\nТеги: доставка\nПо Казахстану — 2 дня.\n---\n### Уход\nСтирать при 40°C.",
    });
    expect(pre.articles.map((a) => [a.title, a.replaces])).toEqual([
      ["Доставка", true],
      ["Уход", false],
    ]);
    expect((await pricelistOverview(ctx)).articles).toHaveLength(2);

    const r = await addKnowledgeArticles(ctx, pre.articles);
    expect(r).toEqual({ added: 1, updated: 1, total: 3 });
    const o = await pricelistOverview(ctx);
    expect(o.articles.map((a) => [a.title, a.content])).toEqual([
      ["Uchino", "Японская марка."],
      ["Доставка", "По Казахстану — 2 дня."],
      ["Уход", "Стирать при 40°C."],
    ]);
    expect(o.articles[1]!.tags).toEqual(["доставка"]);
  });

  it("загрузка статей из Word: файл без разделителей — статья с именем файла", async () => {
    const { zipFiles } = await import("@/core/export/zip");
    const doc = zipFiles([
      {
        name: "word/document.xml",
        data: '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Rivolta Carmignani — Италия.</w:t></w:r></w:p><w:p><w:r><w:t>Поставляет в отели люкс.</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const pre = await previewKnowledgeImport(ctx0(), {
      fileName: "Rivolta_Carmignani.docx",
      base64: `data:application/octet-stream;base64,${doc.toString("base64")}`,
    });
    expect(pre.articles).toEqual([
      {
        title: "Rivolta Carmignani",
        tags: [],
        content: "Rivolta Carmignani — Италия.\nПоставляет в отели люкс.",
        replaces: false,
      },
    ]);
  });

  it("загрузка статей: скан PDF, большой файл и пустой выбор — ошибки продавцу", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const scan = await (async () => {
      const d = await PDFDocument.create();
      d.addPage();
      return Buffer.from(await d.save()).toString("base64");
    })();
    await expect(
      previewKnowledgeImport(ctx0(), { fileName: "scan.pdf", base64: scan }),
    ).rejects.toMatchObject({ key: "err.pricelist.kbPdfScan" });
    await expect(
      previewKnowledgeImport(ctx0(), {
        fileName: "big.txt",
        base64: Buffer.alloc(3 * 1024 * 1024 + 1, 97).toString("base64"),
      }),
    ).rejects.toMatchObject({ key: "err.pricelist.kbFileTooBig" });
    await expect(
      addKnowledgeArticles(ctx0(), [{ title: " ", tags: [], content: "x" }]),
    ).rejects.toMatchObject({
      key: "err.pricelist.kbNothingChosen",
    });
  });

  it("две загрузки статей одновременно не затирают друг друга", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(ctx, [{ title: "Uchino", content: "Японская марка." }]);
    await Promise.all([
      addKnowledgeArticles(ctx, [{ title: "Доставка", tags: [], content: "2 дня." }]),
      addKnowledgeArticles(ctx, [{ title: "Уход", tags: [], content: "40°C." }]),
    ]);
    const titles = (await pricelistOverview(ctx)).articles.map((a) => a.title);
    expect(titles).toHaveLength(3);
    expect(new Set(titles)).toEqual(new Set(["Uchino", "Доставка", "Уход"]));
  });

  it("больше 200 статей не добавляется: ошибка, база прежняя", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(
      ctx,
      Array.from({ length: 199 }, (_, i) => ({ title: `Статья ${i}`, content: "т" })),
    );
    await expect(
      addKnowledgeArticles(ctx, [
        { title: "Новая 1", tags: [], content: "т" },
        { title: "Новая 2", tags: [], content: "т" },
      ]),
    ).rejects.toMatchObject({ key: "err.pricelist.kbTooMany" });
    expect((await pricelistOverview(ctx)).articles).toHaveLength(199);
  });

  it("таблица: чужая ссылка не скачивается; загрузка файла отключает таблицу", async () => {
    const ctx = ctxOf();
    await expect(previewPricelistSheetFor(ctx, "https://evil.kz/x.csv")).rejects.toMatchObject({
      key: "err.catalog.sheetBadLink",
    });
    const link =
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit";
    const sheetCsv = "Название;Раздел;Цена\nFeiler;Полотенца;30000\n";
    const f = async () =>
      new Response(sheetCsv, { status: 200, headers: { "content-type": "text/csv" } });
    const pre = await previewPricelistSheetFor(ctx, link, f);
    if (!pre.ok) throw new Error("предпросмотр");
    expect(pre.diff).toMatchObject({ added: 1, removed: 0 });
    await importPricelistSheetFor(ctx, link, pre.fingerprint, f);
    let o = await pricelistOverview(ctx);
    expect(o.sheet).toMatchObject({ url: link, status: { ok: true, count: 1 } });
    expect(o.count).toBe(1);

    const r = await importPricelist(ctx, CSV, "остатки.csv");
    expect(r.sheetDisconnected).toBe(true);
    expect(r.diff).toMatchObject({ added: 2, removed: 1 });
    o = await pricelistOverview(ctx);
    expect(o.sheet).toBeNull();
    expect(o.count).toBe(2);
  });

  it("предпросмотр таблицы и статей закрыт магазину без режима по прайсу", async () => {
    await expect(previewPricelistSheetFor(ctxOf(false), "x")).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
    await expect(previewKnowledgeImport(ctxOf(false), { text: "т" })).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
  });
});

function ctx0() {
  return ctxOf();
}
