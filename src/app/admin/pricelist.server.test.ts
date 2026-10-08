import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";

const removed: string[][] = [];
/** Записи в bots.settings — через patchTenantSettings; здесь их видно и они возвращаются в контекст. */
const patches: Array<{ botId: string; patch: Record<string, unknown> }> = [];
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  patchTenantSettings: async (botId: string, patch: Record<string, unknown>) => {
    patches.push({ botId, patch });
  },
}));
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
  clearConsultantTasks,
  consultantTasks,
  markConsultantTask,
  savePricelistPersona,
  deleteProductMedia,
  importPricelist,
  importPricelistDrive,
  importPricelistSheetFor,
  pricelistCsvFromXlsx,
  previewKnowledgeImport,
  previewPricelistSheetFor,
  pricelistOverview,
  savePricelistArticles,
  savePricelistSettings,
  setManualRate,
} = await import("./pricelist.server");
const { addTask } = await import("@/core/consultant/tasks");
const { DEFAULT_PERSONA } = await import("@/core/consultant/pricelist/persona");

/**
 * «Прайс консультанта» в админке (перенос панели BOVI v1): выгрузка 1С,
 * синонимы и бутик, ручной курс, фотобаза, статьи. Только при включённом
 * операторе режиме «по прайсу».
 */
let n = 0;
function ctxOf(on = true, extra: Record<string, unknown> = {}): TenantContext {
  const id = `10000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  return {
    tenant: {
      id,
      name: "BOVI",
      settings: settingsFromJson(on ? { consultant_pricelist: { enabled: true, ...extra } } : {}),
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

  it("скачок цен в файле — без подтверждения не загружается, с подтверждением загружается", async () => {
    const ctx = ctxOf();
    const rows = (k: number) =>
      [
        "Название;Раздел;Цена",
        ...Array.from({ length: 30 }, (_, i) => `Товар ${i};Полотенца;${(1000 + i) * k}`),
      ].join("\n");
    await importPricelist(ctx, rows(1), "a.csv");
    const r = await importPricelist(ctx, rows(100), "b.csv");
    expect(r).toMatchObject({ needsConfirm: true, diff: { priceChanged: 30 } });
    expect((await pricelistOverview(ctx)).meta?.source).toBe("a.csv");
    const ok = await importPricelist(ctx, rows(100), "b.csv", { confirm: true });
    expect(ok.needsConfirm).toBe(false);
    expect((await pricelistOverview(ctx)).meta?.source).toBe("b.csv");
  });

  it("Excel: перевод строки в ячейке не рвёт позицию", async () => {
    const { zip } = await import("../../../tests/xlsx-zip");
    const cell = (r: number, c: string, v: string) =>
      `<c r="${c}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const book = zip({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
<row r="1">${cell(1, "A", "Название")}${cell(1, "B", "Раздел")}${cell(1, "C", "Цена")}</row>
<row r="2">${cell(2, "A", "Uchino Полотенце\nZero Twist 70x140")}${cell(2, "B", "Полотенца")}<c r="C2"><v>21000</v></c></row>
</sheetData></worksheet>`,
    });
    const ctx = ctxOf();
    const r = await importPricelist(ctx, pricelistCsvFromXlsx(book), "остатки.xlsx");
    expect(r.needsConfirm).toBe(false);
    expect(r.errorCount).toBe(0);
    expect((await pricelistOverview(ctx)).count).toBe(1);
  });

  it("ссылка Google Drive: файл скачивается и загружается; папка и закрытый файл — понятные ошибки", async () => {
    const ctx = ctxOf();
    const link = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing";
    const seen: string[] = [];
    const fetchCsv = (async (url: string) => {
      seen.push(url);
      if (url.startsWith("https://drive.google.com/uc?"))
        return new Response(null, {
          status: 303,
          headers: {
            location: "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp",
          },
        });
      return new Response(CSV, { status: 200, headers: { "content-type": "text/csv" } });
    }) as never;
    const r = await importPricelistDrive(ctx, link, {}, fetchCsv);
    expect(r.needsConfirm).toBe(false);
    expect((await pricelistOverview(ctx)).meta?.source).toBe("Google Drive");
    expect(seen).toEqual([
      "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
      "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp",
    ]);

    await expect(
      importPricelistDrive(
        ctx,
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
        {},
        fetchCsv,
      ),
    ).rejects.toMatchObject({ key: "err.pricelist.driveFolder" });
    await expect(
      importPricelistDrive(ctx, "https://evil.test/file/d/x", {}, fetchCsv),
    ).rejects.toMatchObject({ key: "err.pricelist.driveLink" });
    const html = (async () =>
      new Response("<!DOCTYPE html><html>Вход</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as never;
    await expect(importPricelistDrive(ctx, link, {}, html)).rejects.toMatchObject({
      key: "err.pricelist.driveClosed",
    });
    const login = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://accounts.google.com/x" },
      })) as never;
    await expect(importPricelistDrive(ctx, link, {}, login)).rejects.toMatchObject({
      key: "err.pricelist.driveClosed",
    });
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

  it("рабочие часы консультанта: по умолчанию BOVI, свои пишутся в настройки, кривые отклоняются", async () => {
    const ctx = ctxOf();
    patches.length = 0;
    const o = await pricelistOverview(ctx);
    expect(o.hours).toEqual({ open: 10, close: 21 });
    // Те же часы, что сейчас, настройку не пишут.
    await savePricelistSettings(ctx, {
      synonyms: "",
      shopUrl: "",
      store: o.store,
      hours: { open: 10, close: 21 },
    });
    expect(patches).toEqual([]);
    await savePricelistSettings(ctx, {
      synonyms: "",
      shopUrl: "",
      store: o.store,
      hours: { open: 9, close: 20 },
    });
    expect(patches).toEqual([
      { botId: ctx.tenant.id, patch: { consultant_pricelist: { hours: { open: 9, close: 20 } } } },
    ]);
    for (const hours of [
      { open: 10, close: 10 },
      { open: 25, close: 3 },
      { open: 1, close: 0 },
    ])
      await expect(
        savePricelistSettings(ctx, { synonyms: "", shopUrl: "", store: o.store, hours }),
      ).rejects.toMatchObject({ key: "err.pricelist.badHours" });
    // Часы магазина читаются из настроек клиента.
    expect((await pricelistOverview(ctxOf(true, { hours: { open: 9, close: 20 } }))).hours).toEqual(
      {
        open: 9,
        close: 20,
      },
    );
  });

  it("образ консультанта: по умолчанию текст BOVI, свой пишется, стандартный убирает настройку", async () => {
    const ctx = ctxOf();
    patches.length = 0;
    const o = await pricelistOverview(ctx);
    expect(o.persona).toEqual(DEFAULT_PERSONA);
    expect(o.personaCustom).toBe(false);
    expect(await savePricelistPersona(ctx, DEFAULT_PERSONA)).toEqual({ custom: false });
    expect(patches.at(-1)!.patch).toEqual({ consultant_pricelist: { persona: null } });
    expect(
      await savePricelistPersona(ctx, {
        brand: "Хлопок",
        about: "Детский текстиль.",
        tone: "Тепло.",
        specialities: "",
      }),
    ).toEqual({ custom: true });
    expect(patches.at(-1)!.patch).toEqual({
      consultant_pricelist: {
        persona: { brand: "Хлопок", about: "Детский текстиль.", tone: "Тепло.", specialities: "" },
      },
    });
    await expect(
      savePricelistPersona(ctx, { brand: " ", about: "", tone: "", specialities: "" }),
    ).rejects.toMatchObject({ key: "err.pricelist.noBrand" });
    // Свой образ показывается как свой.
    const saved = await pricelistOverview(
      ctxOf(true, { persona: { brand: "Хлопок", about: "", tone: "", specialities: "" } }),
    );
    expect(saved.personaCustom).toBe(true);
    expect(saved.persona.brand).toBe("Хлопок");
  });

  it("задачи консультанта: список, отметка, очистка сделанных, чужой id — ошибка", async () => {
    const ctx = ctxOf();
    const a = await addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "Берёт полотенце" });
    await addTask(ctx, { userKey: "ig:2", reason: "complaint", text: "Затяжка" });
    const list = await consultantTasks(ctx);
    expect(list.open).toBe(2);
    expect(list.tasks.map((t) => t.reason)).toContain("purchase");
    await markConsultantTask(ctx, a!.id, true);
    expect((await consultantTasks(ctx)).open).toBe(1);
    await expect(markConsultantTask(ctx, "tsk_нет", true)).rejects.toMatchObject({
      key: "err.pricelist.noTask",
    });
    expect(await clearConsultantTasks(ctx, "done")).toEqual({ removed: 1 });
    expect((await consultantTasks(ctx)).tasks.map((t) => t.userKey)).toEqual(["ig:2"]);
    expect(await clearConsultantTasks(ctx, "all")).toEqual({ removed: 1 });
    expect((await consultantTasks(ctx)).tasks).toEqual([]);
  });

  it("задачи и образ закрыты магазину без режима по прайсу", async () => {
    const off = ctxOf(false);
    await expect(consultantTasks(off)).rejects.toMatchObject({ key: "err.pricelist.off" });
    await expect(clearConsultantTasks(off, "all")).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
    await expect(savePricelistPersona(off, null)).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
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
